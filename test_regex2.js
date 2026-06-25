const regex = /"(https:(?:\/|\\\/)(?:\/|\\\/)[^"]+\.mp4[^"]*)"/gi;
const testStr1 = '"https://v.pinimg.com/1.mp4"';
const testStr2 = '"https:\\/\\/v.pinimg.com\\/2.mp4"';

console.log("Test 1:", regex.exec(testStr1)?.[1]);
regex.lastIndex = 0;
console.log("Test 2:", regex.exec(testStr2)?.[1]);
