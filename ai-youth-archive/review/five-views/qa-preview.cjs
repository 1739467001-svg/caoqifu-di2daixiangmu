// Isolated synthetic desktop QA. Main preview remains on 4174.
const {createPreviewServer} = require('../../preview.cjs');
createPreviewServer({apiPort:8790}).listen(4175,'127.0.0.1',()=>console.log('Five-view QA: http://127.0.0.1:4175/ai-youth/'));
