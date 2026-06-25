const fs = require('fs');
const html = fs.readFileSync('pin.html', 'utf8');

try {
    const pwsDataMatch = html.split('<script id="__PWS_DATA__" type="application/json">')[1].split('</script>')[0];
    const pwsData = JSON.parse(pwsDataMatch);
    fs.writeFileSync('pwsData.json', JSON.stringify(pwsData, null, 2));
    console.log('Saved pwsData.json');
} catch (e) {
    console.log('pws_data err:', e.message);
}

try {
    const initialPropsMatch = html.split('<script id="__PWS_INITIAL_PROPS__" type="application/json">')[1].split('</script>')[0];
    const initialProps = JSON.parse(initialPropsMatch);
    fs.writeFileSync('initialProps.json', JSON.stringify(initialProps, null, 2));
    console.log('Saved initialProps.json');
} catch (e) {
    console.log('initial_props err:', e.message);
}

try {
    let relayData = [];
    const splits = html.split('__PWS_RELAY_REGISTER_COMPLETED_REQUEST__');
    for (let i = 1; i < splits.length; i++) {
        const payloadStr = splits[i].match(/\(.*?, (\{.*?\})\);/);
        if (payloadStr) {
            relayData.push(JSON.parse(payloadStr[1]));
        }
    }
    fs.writeFileSync('relayData.json', JSON.stringify(relayData, null, 2));
    console.log('Saved relayData.json');
} catch (e) {
    console.log('relay_data err:', e.message);
}
