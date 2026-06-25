const fs = require('fs');
const html = fs.readFileSync('pin.html', 'utf8');

const regex1 = /"(https:\/\/[^"]+\.mp4[^"]*)"/g;
const regex2 = /"(https:[^"]+\.mp4[^"]*)"/g;

let match;
console.log("Regex 1 matches:");
while ((match = regex1.exec(html)) !== null) {
    console.log(match[1]);
}

console.log("Regex 2 matches:");
while ((match = regex2.exec(html)) !== null) {
    console.log(match[1]);
}
