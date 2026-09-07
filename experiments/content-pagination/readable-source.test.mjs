import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Window} from 'happy-dom';
import {htmlToReadableText, readableSource} from './readable-source.mjs';
const window = new Window();
const document = window.document;

test('readable article retains headings, paragraph/list boundaries, Unicode and decoded entities',()=>{
  const html='<h2>Jaguars &amp; Bears 🦋</h2><p>Wins: <strong>9.0</strong><br>Playoffs: 52.4%.</p><p>Second paragraph: caf&eacute; 漢字.</p><ul><li>One &lt; two</li><li>Second item</li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>';
  const text=htmlToReadableText(html,document);
  assert.equal(text,'## Jaguars & Bears 🦋\n\nWins: 9.0\nPlayoffs: 52.4%.\n\nSecond paragraph: café 漢字.\n\n- One < two\n\n- Second item\n\n3. Third\n\n4. Fourth');
  assert.ok(text.isWellFormed());
});

test('anchor labels and semantic href values remain exact, without URL resolution',()=>{
  const html='<p><a href="https://example.com/a_(b)?x=1&amp;y=%E6%BC%A2#frag">Player [one]</a> and <a href="../next?q=🦋">Next <strong>page</strong></a> <a name="local"></a> <a href="#local">Local</a></p>';
  const text=htmlToReadableText(html,document);
  assert.equal(text,'[Player \\[one\\]](<https://example.com/a_(b)?x=1&y=%E6%BC%A2#frag>) and [Next page](<../next?q=🦋>)  [Local](<#local>)');
  assert.ok(!text.includes('href='));
});

test('selected fragments change only story values, keeping paths, context and other data intact',()=>{
  const source={blocks:[{path:['article','story'],value:'<h2>Team</h2><p>9.0 wins</p>',context:{headline:'<b>Untouched</b>',apiUrl:'https://example.com/exact?a=1&b=2'}},{path:['article','description'],value:'<p>Untouched description</p>'},{path:['articles',1],value:{headline:'Untouched',story:'<p>Detail</p>',imageUrl:'https://example.com/img.jpg'}}],tag:'unchanged'};
  const result=JSON.parse(readableSource(JSON.stringify(source),document));
  assert.deepEqual(result,{...source,blocks:[{...source.blocks[0],value:'## Team\n\n9.0 wins'},source.blocks[1],{...source.blocks[2],value:{...source.blocks[2].value,story:'Detail'}}]});
});

test('unsplit source supports article.story and HN story.text without changing plain strings',()=>{
  const source={article:{story:'<p>Article</p>'},story:{text:'<p>HN text</p>',title:'<b>Title</b>'},text:'<p>Other</p>',plain:42};
  assert.deepEqual(JSON.parse(readableSource(JSON.stringify(source),document)),{...source,article:{story:'Article'},story:{text:'HN text',title:'<b>Title</b>'}});
  const plain='Plain 🦋 story\n\n  keeps whitespace';
  assert.equal(htmlToReadableText(plain,document),plain);
});

test('source HTML is never attached or executed; non-display metadata is omitted',()=>{
  const html='<script>globalThis.executedReadableSource=true</script><style>body{color:red}</style><p onclick="bad()">Visible <img src="https://example.com/photo" alt="photo caption"></p><iframe src="https://example.com/frame"></iframe><!-- hidden -->';
  assert.equal(htmlToReadableText(html,document),'Visible photo caption');
  assert.equal(globalThis.executedReadableSource,undefined);
  assert.equal(window.document.body.innerHTML,'');
});

test('resource-bearing HTML remains inside detached template content',()=>{
  const templates=[];
  const inertDocument={createElement(tag){
    assert.equal(tag,'template','formatter must never create an active parsed document');
    const template=document.createElement(tag);templates.push(template);return template;
  }};
  assert.equal(htmlToReadableText('<p>Text</p><img src="https://example.com/image"><iframe src="https://example.com/frame"></iframe>',inertDocument),'Text');
  assert.equal(templates.length,1);
  assert.equal(templates[0].isConnected,false);
  assert.equal(templates[0].content.querySelector('iframe').isConnected,false);
  assert.equal(document.querySelector('iframe'),null);
});
