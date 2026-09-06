"""Exercise the browser-login UI without contacting OpenAI or loading real auth."""
import argparse
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5189/')
args = parser.parse_args()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page()
        page.goto(args.url)
        page.wait_for_load_state('networkidle')
        page.evaluate('async () => await window.ready')
        page.evaluate('''() => {
          window.mockCounts = {tokens: 0, models: 0};
          window.rejectToken = false;
          const canvas = document.createElement('canvas');
          canvas.width = 4; canvas.height = 4;
          const png = canvas.toDataURL().split(',')[1];
          libcurl.fetch = async (url, options) => {
            if (url === 'https://auth.openai.com/oauth/token') {
              mockCounts.tokens++;
              const form = new URLSearchParams(options.body);
              if (form.get('redirect_uri') !== 'http://localhost:1455/auth/callback' || !form.get('code_verifier')) throw Error('Bad exchange');
              if (window.rejectToken) return new Response('', {status: 401});
              const claims = btoa(JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: 'fake-account'}}));
              return Response.json({access_token: `fake.${claims}.fake`});
            }
            if (url !== 'https://chatgpt.com/backend-api/codex/responses') throw Error('Unexpected network destination');
            mockCounts.models++;
            const body = JSON.parse(options.body);
            const output = body.tools ? [{type:'image_generation_call',status:'completed',result:png}] :
              [{type:'message',content:[{type:'output_text',text:'{"label":"Read story"}'}]}];
            return new Response('data: ' + JSON.stringify({type:'response.completed',response:{status:'completed',output,usage:{input_tokens:1,output_tokens:1}}}) + '\\n\\n');
          };
        }''')
        page.get_by_role('button', name='Try browser sign-in', exact=True).click()
        auth_url = page.get_by_role('link', name='Continue on OpenAI').get_attribute('href')
        state = parse_qs(urlparse(auth_url).query)['state'][0]
        input_field = page.get_by_label('Return URL from the address bar')
        submit = page.get_by_role('button', name='Complete sign-in and test')
        input_field.fill('http://localhost:1455/auth/callback?code=fake&state=wrong')
        submit.click()
        page.get_by_role('status').filter(has_text='different sign-in').wait_for()
        assert page.evaluate('mockCounts.tokens') == 0
        input_field.fill(f'http://localhost:1455/auth/callback?code=fake&state={state}')
        submit.click()
        page.get_by_role('status').filter(has_text='Both model tests passed').wait_for()
        assert page.evaluate('mockCounts') == {'tokens': 1, 'models': 2}
        assert input_field.input_value() == ''
        assert page.get_by_role('button', name='Try browser sign-in', exact=True).is_enabled()
        assert page.evaluate('localStorage.length + sessionStorage.length') == 0
        page.get_by_role('button', name='Try browser sign-in', exact=True).click()
        next_url = page.get_by_role('link', name='Continue on OpenAI').get_attribute('href')
        next_state = parse_qs(urlparse(next_url).query)['state'][0]
        assert state != next_state
        page.evaluate('window.rejectToken = true')
        input_field.fill(f'http://localhost:1455/auth/callback?code=fake&state={next_state}')
        submit.click()
        page.get_by_role('status').filter(has_text='Token exchange failed (HTTP 401)').wait_for()
        assert page.evaluate('mockCounts.tokens') == 2
        assert input_field.input_value() == ''
        assert page.get_by_role('button', name='Try browser sign-in', exact=True).is_enabled()
        print('PASS: wrong-state rejection, browser token exchange, both simulated model results, input cleanup, no persisted auth, and failed-exchange recovery.')
    finally:
        browser.close()
