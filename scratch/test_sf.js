const { spawn } = require('child_process');

const sf = spawn('/opt/homebrew/bin/stockfish');
let bestPv = '';

sf.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
        if (line.includes(' pv ')) {
            bestPv = line.split(' pv ')[1];
        }
        if (line.startsWith('bestmove')) {
            console.log('White response to Qh3:', bestPv);
            sf.kill();
        }
    }
});

sf.stdin.write('position fen r1b3k1/1pN3pp/3b3r/p2P4/2Q4P/1P3pPq/P4P2/2R2RKB w - - 3 24\n');
sf.stdin.write('go depth 18\n');
