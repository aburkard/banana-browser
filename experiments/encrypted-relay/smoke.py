"""Run against the experiment relay; credentials never pass through its HTTP API."""
import argparse
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5189/', help='Local or deployed relay test page')
parser.add_argument('--relay-url', help='Override relay config to test a separately hosted static frontend')
parser.add_argument('--existing-login', action='store_true', help='Use existing Codex auth in browser memory for one screenshot and one image call')
parser.add_argument('--screenshot', help='Optional output screenshot path')
args = parser.parse_args()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        sockets = []
        page.on('websocket', lambda socket: sockets.append(socket.url))
        if args.relay_url:
            page.route('**/relay-config.json', lambda route: route.fulfill(json={'url': args.relay_url}))
        page.goto(args.url)
        page.wait_for_load_state('networkidle')
        page.evaluate('async () => await window.ready')
        result = page.evaluate('''async () => {
          const response = await libcurl.fetch('https://example.com/', {
            headers: {'X-Banana-Probe': 'BANANA_TUNNEL_PROBE_2026'},
            signal: AbortSignal.timeout(20000),
          });
          const content = await response.text();
          let certificateError = '';
          try {
            await libcurl.fetch('https://expired.badssl.com/', {signal: AbortSignal.timeout(20000)});
          } catch (error) { certificateError = String(error); }
          const device = await experiment.startLogin();
          return {
            publicRequestStatus: response.status,
            publicRequestCorrect: content.includes('Example Domain'),
            invalidCertificateRejected: /error code 60/.test(certificateError),
            deviceCodeIssued: !!(device.user_code || device.usercode),
          };
        }''')
        print(json.dumps(result), flush=True)
        assert result['publicRequestStatus'] == 200 and result['publicRequestCorrect']
        assert result['invalidCertificateRejected'], 'Certificate validation failed; refusing to load credentials'
        assert result['deviceCodeIssued']
        if args.existing_login:
            auth_path = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'auth.json'
            tokens = json.loads(auth_path.read_text())['tokens']
            credentials = {'accessToken': tokens['access_token'], 'accountId': tokens['account_id']}
            try:
                result = page.evaluate('async auth => await experiment.runExperiment(auth)', credentials)
            finally:
                credentials.clear()
                tokens.clear()
            assert result['imageWidth'] > 0 and result['imageHeight'] > 0
            assert not result['stats']['plaintextMarkerSeen']
            print('Live model tests: ' + json.dumps(result), flush=True)
        # The service is a byte relay; a generic CORS request to it can't load files.
        assert page.request.get(args.url.rstrip('/') + '/auth.json').status == 404
        assert page.request.get(args.url.rstrip('/') + '/node_modules/ws/package.json').status == 404
        stats = page.evaluate("async url => (await fetch(new URL('/stats', url))).json()", args.relay_url or args.url)
        assert stats['tlsHandshakes'] > 0 and not stats['plaintextMarkerSeen']
        expected_socket = (args.relay_url or args.url).replace('https:', 'wss:').replace('http:', 'ws:').rstrip('/') + '/tunnel/'
        assert sockets and all(url.startswith(expected_socket) for url in sockets)
        print('Relay stats: ' + json.dumps(stats), flush=True)
        if args.screenshot:
            page.screenshot(path=args.screenshot, full_page=True)
    finally:
        browser.close()
