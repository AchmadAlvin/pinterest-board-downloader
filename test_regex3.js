const testStr = `"video_list":{"V_720P":{"width":720,"height":1280,"url":"https:\\/\\/v.pinimg.com\\/1.mp4","duration":15000}}`;
const regex = /"(V_1080P|V_720P|V_480P|V_240P|V_ENC_1080P|V_ENC_720P|V_ENC_480P)"\s*:\s*\{[^}]*"url"\s*:\s*"(https:[^"]+)"/gi;

let match;
while ((match = regex.exec(testStr)) !== null) {
    console.log(match[1], match[2]);
}
