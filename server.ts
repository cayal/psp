import { decodeFrames, pongFrame, prepareFrame, WSChangeset } from './src/websockets/websocketFraming';
import { LinkPeeps, LinkPeepLocator } from './src/paths/linkPeeping';
import { PukableEntrypoint } from './src/pukables/entrypoints';
import { MessageChannel } from 'node:worker_threads'
import { FSPeepRoot } from './src/paths/filePeeping'
import { createSecureServer } from 'node:http2'
import { PP } from './src/fmt/ppstuff.js';
import { readFileSync } from 'node:fs';
import { L } from './src/fmt/logging';
import { createServer } from 'net';
import { Socket } from 'node:net';


L.log(`Hi (${process.pid})\n`)

const WEBROOT = 'web'
const RELOADER_SCRIPT = '\n<script>\n' +  readFileSync('./src/websockets/websocketReloading.js', 'utf-8') + '\n</script>\n'
let cannotPuke = false

const { port1: changeReceiver, port2: changeTransmitter } = new MessageChannel()

const webpathsToPukers: { [webpath: string]: PukableEntrypoint } = {}

let relpathsToPukers: { [relpath: string]: PukableEntrypoint[] } = {}

const obs = new PerformanceObserver((items) => {
    L.log(`${items.getEntries()[0].name} in ${items.getEntries()[0].duration} ms\n`);
    performance.clearMarks();
});

obs.observe({ type: 'measure' });

performance.mark('a')

const webrootDir = FSPeepRoot({ entrypoint: WEBROOT })
const indexFSPeeps = webrootDir.peepReduce(((acc, peep) => peep.path.base == 'index.html' ? acc.concat(peep) : acc), [])
webrootDir.getWatcher(changeTransmitter)

performance.mark('b')
performance.measure('Built file watch tree', 'a', 'b')

L.log(`Serving from: ${webrootDir.relpath}\n`)
for (let l of webrootDir.repr()) {
    L.log(l)
}

const server = createSecureServer({
    maxSessionMemory: 1000,
    allowHTTP1: true,
    key: readFileSync('localhost-key.pem'),
    cert: readFileSync('localhost.pem'),
})


L.log(PP.styles.pink + `\n> Using ${PP.ar(indexFSPeeps.map((i: any) => i.relpath))} as entrypoints. \n` + PP.styles.none)

const build = async (pLinks: LinkPeeps, relpathToBuild?: string) => {
    relpathsToPukers = {}
    const loc = LinkPeepLocator(pLinks)

    const buildSet = relpathToBuild ? [pLinks.links.find(l => l.relpath === relpathToBuild)] : indexFSPeeps
    if (!buildSet) {
        console.error('Nothing to build.')
        cannotPuke = true;
        return
    }

    let entrypointsBuilt = []
    try {

        performance.mark('a')
        for (let iPeep of buildSet) {
            const entrypoint = new PukableEntrypoint(loc, iPeep.relpath, undefined, RELOADER_SCRIPT)
            webpathsToPukers[entrypoint.ownLink.webpath] = entrypoint

            for (let assoc of entrypoint.getAssociatedFilenames()) {
                if (!relpathsToPukers[assoc]) { relpathsToPukers[assoc] = []}
                relpathsToPukers[assoc].push(entrypoint)
            }

            relpathsToPukers[entrypoint.ownLink.relpath] = [entrypoint]
            entrypointsBuilt.push(entrypoint)
        }
        performance.mark('b')
        performance.measure('Built PukableEntrypoints from index files', 'a', 'b')
    } catch (e) {
        console.error(e)
        console.error("Ran into a problem building files.")
        cannotPuke = true
    }
    return {
        pLinks: pLinks,
        entrypointsBuilt: entrypointsBuilt
    }
}

let buildTask = build(LinkPeeps({ entrypoint: webrootDir }))

let enqueueReplRepr = null;
changeReceiver.addEventListener("message", (ev: MessageEvent) => {

    let [mode, relpath] = ev.data.split(" ")
    if (mode == "change") {
        buildTask = build(LinkPeeps({entrypoint: webrootDir}), relpath)
        enqueueReplRepr = relpath
        changeTransmitter.postMessage(`built ${relpath}`)
    } else if (mode == 'built' && (relpath === enqueueReplRepr)) {
        let builtPoint = relpathsToPukers[relpath][0]
        for (let devInfo of builtPoint.debugRepr()) {
            L.log(devInfo)
        }
        enqueueReplRepr = null
    }
})

server.on('stream', async (stream, headers) => {
    if (headers[':method'] != 'GET') {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 501,
        });
        stream.write('Not implemented')
        stream.end()
    }

    // Refresh LinkPeeps, since files might have been created/deleted.
    const pLinks = LinkPeeps({ entrypoint: webrootDir })

    const path = headers[':path'] || '/'

    let fileMatch
    let chunkProvider: PukableEntrypoint
    if (chunkProvider = webpathsToPukers[path]) {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 200,
        });

        await buildTask

        let entrypoint  = webpathsToPukers[chunkProvider.ownLink.webpath]

        for (let v of entrypoint.blowChunks()) {
            if (!v) {
                console.warn('Warning: undefined value in stream')
                continue
            }
            stream.write(v)
        }
        stream.end()
        return

    }
    else if (fileMatch = pLinks[path]) {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 200,
        });
        stream.write("TODO not implemented")
        stream.end()
        return
    }
    else {
        stream.respond({
            'content-type': 'text/html; charset=utf-8',
            ':status': 404,
        });
        stream.write('404 Not Found')
        stream.end()
        return
    }


})

/**
* 
* @param {string[]} lines - Each line of an HTTP header message
* @returns {function(keyReg: RegExp): ?string}
*/
function headerExtract(lines) {
    /**
     * @param {RegExp} keyReg - Regular expression literal matching all of a key (e.g. /^Sec-WebSocket-Key: /)
     * @returns {?string} - The value, if found
     */
    return (keyReg) => {
        return lines
            .slice(1)
            .map(l => l.split(keyReg)?.[1])
            .find(l => l)
    }
}

const changeset = WSChangeset(changeReceiver)
const Enc = new TextEncoder()

const websocket = createServer({ 
    keepAlive: true, 
    keepAliveInitialDelay: 1000, 
}, async (socket: Socket & {id?: number}) => {
    let accept;

    changeset.addSocket(socket, relpathsToPukers)
    
    socket.addListener("error", (e) => {
        changeReceiver.removeListener("message", changeset.listeners[socket.id].cb)
        console.log('------------')
        console.error(e.message)
        console.error(e.cause)
        console.log('------------')
    })

    socket.addListener("close", () => {
        L.log(`(Sock#${socket.id}) | Socket closing.\n`)
        changeReceiver.removeListener("message", changeset.listeners[socket.id].cb)
        socket.end()
        socket.destroy()
    })

    socket.addListener("data", async (data) => {
        if (accept !== undefined) {
            let res = decodeFrames(data)
            if (res.error == true) {
                socket.end()
                socket.destroy(new Error(res.reason))
                return

            } if (res.opcode === 'clos') {
                socket.end()

            } else if (res.opcode === 'ping') {
                console.info(`Received ping from ${socket.id}. Responding with pong...`)
                socket.write(pongFrame(res.data as number[]))

            } else if (res.opcode === 'pong') {
                changeset.keepalive(socket.id, res.data as number[])

            } else if (res.opcode === 'dtxt') {
                console.warn(`${socket.id} | Got some text.`)
                console.warn(res.data)

            } else {
                console.warn(`${socket.id} | Got a bag of data.`)
                console.warn(res.data)
            }
        }
        else {
            const lines = data.toString().split('\r\n')
            const hval = headerExtract(lines)
                if (lines?.[0].endsWith('HTTP/1.1')) {
                    if (!(hval(/^Upgrade: /) === 'websocket')) {
                        socket.write(Enc.encode([
                            'HTTP/1.1 426 Upgrade Required',
                            'Upgrade: websocket',
                            'Connection: Upgrade',
                            '',
                            ''
                        ].join('\r\n')))
                        return
                    }

                    const swk = hval(/^Sec-WebSocket-Key: /)
                    const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
                    const inKey = swk + magic
                    accept = await crypto.subtle.digest('sha-1', Enc.encode(inKey))
                    const b64accept = btoa(String.fromCharCode(...new Uint8Array(accept)))

                    const rb = Enc.encode([
                        'HTTP/1.1 101 Switching Protocols',
                        'Upgrade: websocket',
                        'Connection: Upgrade',
                        `Sec-WebSocket-Accept: ${b64accept}`,
                        '',
                        ''
                    ].join('\r\n'))

                    socket.write(rb)
                    socket.write(prepareFrame(`hi ${socket.id}`))
                    L.log(`(Sock#${socket.id}) Updater connected. Starting pings. \n`)
                    changeset.startPings(socket.id)
                    return
                }
            }
    })
})

process.on('SIGTERM', onSIGTERM);

function onSIGTERM() {
    server.close()
    websocket.close()
    process.exit(0);
}

websocket.listen(80)
L.log(PP.styles.blue + "websocket | Listening on port 80...\n" + PP.styles.none)

server.listen(3003)
L.log(PP.styles.blue + "https | Listening on port 3003...\n" + PP.styles.none)