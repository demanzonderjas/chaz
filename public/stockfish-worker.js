// Stockfish 18 Web Worker wrapper (UCI protocol)
let sf = null;

async function initStockfish() {
  importScripts('/stockfish/stockfish-18-single.js');

  sf = await Stockfish({
    locateFile: (path) => path.endsWith('.wasm')
      ? '/stockfish/stockfish-18-single.wasm'
      : '/stockfish/' + path,
  });

  sf.addMessageListener((line) => {
    postMessage({ type: 'uci', line });
  });

  sf.postMessage('uci');
  sf.postMessage('isready');
}

initStockfish().catch((e) => postMessage({ type: 'error', message: String(e) }));

onmessage = (e) => {
  if (!sf) return;
  const { cmd } = e.data;
  if (cmd) sf.postMessage(cmd);
};
