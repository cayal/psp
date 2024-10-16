const _tryConnect = () => {
    if (!(window._updateSource) || (window._updateSource?.readyState === 3)) {

        console.info('Trying to connect to source update notifier...');

        if (window._updateSource = new WebSocket('ws://localhost/_updates')) {
            console.info('Update notifier connected.');
            window._updateSource.onmessage = ((ev) => {
                if (!ev.data) {
                    console.info('Received blank message from server.')
                    return
                }
                let [what, how] = ev.data.split(" ")
                if (what === 'hi') {
                    window._updateSource.socketId = how
                    console.log(`Took ID ${window._updateSource.socketId}.`)
                }
                else if (what === 'built' && how === new URL(window.location).pathname) {
                    console.log("Page changed. Refreshing...")
                        window.location.reload()
                } else {
                    console.warn(`Unknown message '${ev.data}'`)
                }
            });
        }
    }
}; 

_tryConnect(); 
setInterval(_tryConnect, 1000); 
