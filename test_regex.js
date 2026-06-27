const html1 = '\"url\":\"https:\\/\\/v1.pinimg.com\\/videos\\/mc\\/720p\\/123.mp4\"';

// This is what the raw HTML usually looks like: `https:\/\/v1.pinimg.com\/videos\/mc\/720p\/123.mp4`
console.log(html1);

// We need a regex that matches `https:` followed by `//` or `:\/\/` or `\\/\\/` and then anything not a quote until `.mp4`.
const regex1 = /https:(?:\\\/|\/){2,}[^"'\s<>&]+\.mp4[^"'\s<>&]*/gi;

let m;
while ((m = regex1.exec(html1)) !== null) {
    console.log("Matched: " + m[0]);
}

const html2 = 'https://v1.pinimg.com/videos/mc/720p/123.mp4';
while ((m = regex1.exec(html2)) !== null) {
    console.log("Matched 2: " + m[0]);
}

const html3 = 'https:\\/\\/v1.pinimg.com\\/videos\\/mc\\/720p\\/123.mp4?xyz=123';
while ((m = regex1.exec(html3)) !== null) {
    console.log("Matched 3: " + m[0]);
}
