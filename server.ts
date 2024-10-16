import { createServer } from 'net';
import { createSecureServer } from 'node:http2'
import { Stats, existsSync, readFileSync, readdirSync, statSync, watch } from 'node:fs';
import path, { dirname } from 'node:path';
import { MessageChannel } from 'node:worker_threads'
import assert from 'node:assert';
import { PukableEntrypoint } from './entrypointStreaming';
import { HData, LinkPeeps, LinkPeepLocator, PLink, QF, PLinkLocable } from './linkPeeping';
import { PukableSlotPocket } from './htmlSlotPocketing';
import { FSPeep, FSPeepRoot } from './filePeeping';
import { PP } from './ppstuff.js';
import { Socket } from 'node:net';

process.stderr.write(`Hi (${process.pid})\n`)

let cannotPuke = false

const WEBROOT = 'src'
const RELOADER_SCRIPT = '\n<script>\n' +  readFileSync('websocketReloading.js', 'utf-8') + '\n</script>\n'
const { port1: changeReceiver, port2: changeTransmitter } = new MessageChannel()

performance.mark('A')
const webrootDir = FSPeepRoot({ entrypoint: WEBROOT })
performance.mark('B')

performance.measure('Built file tree in', 'A', 'B')

process.stderr.write(`Serving from: ${webrootDir.relpath}\n`)
for (let l of webrootDir.repr()) {
    process.stderr.write(l)
}

webrootDir.getWatcher(changeTransmitter)

const obs = new PerformanceObserver((items) => {
    process.stderr.write(`${items.getEntries()[0].name} in ${items.getEntries()[0].duration} ms\n`);
    performance.clearMarks();
});

obs.observe({ type: 'measure' });


function enumerateIndexes(peep: FSPeep) {
    if (peep.imp == 'd') {
        return peep
            .getDescendants()
            .flatMap(enumerateIndexes)
    }
    else if (peep.relpath.split('/').slice(-1)?.[0] == 'index.html') {
        return [peep]
    } else {
        return []
    }
}


const server = createSecureServer({
    maxSessionMemory: 1000,
    allowHTTP1: true,
    key: readFileSync('localhost-key.pem'),
    cert: readFileSync('localhost.pem'),
})

const idxFSPeeps = webrootDir.peepReduce(((acc, peep) => peep.path.base == 'index.html' ? acc.concat(peep) : acc), [])
process.stderr.write(PP.styles.pink + `\n> Using ${PP.ar(idxFSPeeps.map((i: any) => i.relpath))} as entrypoints. \n` + PP.styles.none)
const webpathsToPukers: { [webpath: string]: PukableEntrypoint } = {}
const relpathsToPukers: { [relpath: string]: PukableEntrypoint[] } = {}

const build = (pLinks: LinkPeeps, relpathToBuild?: string) => {
    const loc = LinkPeepLocator(pLinks)

    const buildSet = relpathToBuild ? [pLinks.links.find(l => l.relpath === relpathToBuild)] : idxFSPeeps
    if (!buildSet) {
        console.error('Nothing to build.')
        cannotPuke = true;
        return
    }

    let entrypointsBuilt = []
    try {
        for (let iPeep of buildSet) {
            const entrypoint = new PukableEntrypoint(loc, iPeep.relpath, undefined, RELOADER_SCRIPT)
            webpathsToPukers[entrypoint.ownLink.webpath] = entrypoint

            const relpaths = entrypoint.getAssociatedFilenames()

            relpathsToPukers[entrypoint.ownLink.relpath] = [entrypoint]
            entrypointsBuilt.push(entrypoint)
        }
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


build(LinkPeeps({ entrypoint: webrootDir }))

changeReceiver.addEventListener("message", (ev: MessageEvent) => {
    let [mode, relpath] = ev.data.split(" ")
    if (mode == "change") {
        build(LinkPeeps({entrypoint: webrootDir}), relpath)
        changeTransmitter.postMessage(`built ${relpath}`)
    }
})

server.on('stream', (stream, headers) => {
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

        webpathsToPukers[chunkProvider.ownLink.webpath] = build(pLinks, chunkProvider.ownLink.relpath).entrypointsBuilt[0]

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


type WSOpcode = {
    cont: 0,
    dtxt: 1,
    dbin: 2,
    clos: 8,
    ping: 9,
    pong: 10,
}

const wsOps: WSOpcode = {
    cont: 0b0000,
    dtxt: 0b0001,
    dbin: 0b0010,
    clos: 0b1000,
    ping: 0b1001,
    pong: 0b1010,
}

const Enc = new TextEncoder()

/**
* 
* @param {string} message 
* @returns {Buffer} Message wrapped as a 1-frame WS message
*/
function prepareFrame(message) {
    const thisisMyFinalFrame = 0b10000000
    const byte1 = thisisMyFinalFrame | wsOps.dtxt
    const msg = Enc.encode(message)
    if (msg.byteLength > 125) {
        console.warn(`Message too long and will be truncated: ${message}`)
        msg = msg.slice(0, 125)
    }
    const isUnmasked = 0b01111111
    const byte2 = isUnmasked & msg.byteLength

    return Uint8Array.from([byte1, byte2, ...msg])
}

let pingCtr = 0
function pingFrame(socketId: number) {
    const thisisMyFinalFrame = 0b10000000
    const byte1 = thisisMyFinalFrame | wsOps.ping

    const byte2 = 1
    console.log("ping counter: " , pingCtr)
    const endByte = (pingCtr++) % 256

    return Uint8Array.from([byte1, byte2, endByte])
}

function pongFrame(data: number[]) {
    let bytes = Uint8Array.from(data)
    bytes[0] = bytes[0] & 0b11110000
    bytes[0] = bytes[0] | wsOps.pong

    return Uint8Array.from(bytes)
}

type WSDecodeRes = { opcode: keyof WSOpcode, data?: string | number[], error: false } | { error: true, reason: string }
function decodeFrames(message: Buffer): WSDecodeRes {
    const bytes = Uint8Array.from(message)
    const isMasked = 0b10000000
    if ((bytes[1] & isMasked) === 0) {
       return { error: true, reason: 'Client sent an unmasked message.'}
    }
    
    const fin = bytes[0] & 0b10000000
    if (!fin) {
           return { error: true, reason: `Multi-frame messages not implemented.`}
    }

    const ov = bytes[0] & 0b00001111
    if (!Object.values(wsOps).includes(ov as WSOpcode[keyof WSOpcode])) {
           return { error: true, reason: `Unsupported opcode ${ov}`}
    }
    const opcode = Object.entries(wsOps).find(([_, ovi]) => ovi == ov)[0]
    
    if (opcode == 'clos') {
            return { opcode: 'clos', error: false }
    }
    
    if (opcode == 'dbin' || opcode == 'cont') {
        // Will add logic to handle these if it ever seems necessary
        console.warn("Browser sent bytes with dbin/cont opcode.")
        console.warn(bytes)
    }
    
    let payloadLength = bytes[1] & 0b01111111
    if (payloadLength > 125) {
       return {error: true, reason: `Message is too large: ${bytes}`}
    }
    
    let mask = new DataView(bytes.buffer, 2, 4)
    let encoded = new DataView(bytes.buffer, 6, payloadLength)

    let decoded = opcode === 'dtxt' ? '' : [];
    let dec = new TextDecoder('utf-8')
    let take = opcode === 'dtxt'
        ? (e, m, i) => decoded += dec.decode(Uint8Array.from([encoded.getUint8(i) ^ mask.getUint8(i%4)]))
        // @ts-ignore
        : (e, m, i) => decoded.push(...Uint8Array.from([encoded.getUint8(i) ^ mask.getUint8(i%4)])) 


    for (let i = 0; i < encoded.byteLength; i++) {
        take(encoded, mask, i)
    }

    return { opcode: opcode as keyof WSOpcode, data: decoded, error: false }
}



function WSChangeset() {
    let sid = 0

    const buildListeners: {
        sk: Socket,
        cb: (_: Event) => void,
        timerId: NodeJS.Timeout,
        lastPingValue: number,
        lastPongTime: number
    }[] = []

    return {
        listeners: buildListeners,
        startPings: _startPings,
        keepalive: _keepalive,
        addSocket: _addSocket
    }
    
    function _startPings(id: number, interval=8000, deadline=3000) {
        if (!buildListeners[id]) { 
            console.error(`No socket ${id} for which to start pings.`)
            return 
        }
        console.log('id: ', id)
        console.log('interval: ', interval)
        console.log('deadline: ', deadline)
        
        let {sk, lastPongTime, timerId} = buildListeners[id]

        console.log('lastPongTime: ', lastPongTime)
        console.log('lastPingValue: ', buildListeners[id].lastPingValue)
        if ((Date.now() - lastPongTime) > (interval + deadline)) {
            console.info(`Socket ${id} timed out: ${Date.now() - lastPongTime} is greater than ${interval + deadline}.`)
            clearTimeout(timerId)
            sk.destroy()
            return
        } else {
            let nextPing = pingFrame(id)
            buildListeners[id].lastPingValue = nextPing[2]
            sk.write(nextPing)
            buildListeners[id].timerId = setTimeout(_startPings, interval, id, interval, deadline)
        }
    }
    
    function _keepalive(id, pongData: number[]) {
        if (!buildListeners[id]) { 
            console.error(`No socket ${id} to keep alive.`)
            return 
        }

        if (!(buildListeners[id].lastPingValue)
            || (pongData[0] === buildListeners[id].lastPingValue)) {
            console.log(`Setting pong time...`)
            buildListeners[id].lastPongTime = Date.now()
        }
    }

    function _addSocket(socket: Socket & {id?: number}) {
        for (let i = 0; i < buildListeners.length; i++) {
            const { sk, cb, lastPongTime: lastSeen } = buildListeners[i]
            if (sk.destroyed || (Date.now() - lastSeen)) {
                changeReceiver.removeEventListener("message", cb)
            }
        }

        if (!socket.id) { socket.id = sid++ }
        if (!buildListeners[socket.id]) {
            buildListeners[socket.id] = {
                lastPongTime: Date.now(),
                sk: socket,
                cb: (ev) => {
                    let [mode, pName] = ev.data.split(" ")
                    if (mode == "built") {
                        const pukerDatas = relpathsToPukers[pName]
                        performance.now()
                        for (let p of pukerDatas) {
                            console.log(p.id)
                            console.log(p.ownLink.relpath)
                            let wp = p.ownLink.webpath

                            process.stderr.write(`${new Date()} | Writing '${wp}' to socket ${socket.id}...\n`)
                            socket.write(prepareFrame(wp))
                        }
                    }
                }
            }

            changeReceiver.addEventListener("message", buildListeners[socket.id].cb)

        }
    }

}


const changeset = WSChangeset()

const websocket = createServer({ 
    keepAlive: true, 
    keepAliveInitialDelay: 1000, 
}, async (socket: Socket & {id?: number}) => {
    let accept;

    changeset.addSocket(socket)
    
    socket.addListener("error", (e) => {
        changeReceiver.removeAllListeners("message")
        console.log('------------')
        console.error(e.message)
        console.error(e.cause)
        console.log('------------')
    })

    socket.addListener("close", () => {
        console.info(`Server closing. Writing 'SERVER_CLOSE' to port ${socket}...\n`)
        changeReceiver.removeAllListeners("message")
        socket.write(prepareFrame("SERVER_CLOSE"))
    })

    socket.addListener("data", async (data) => {
        if (accept !== undefined) {
            let res = decodeFrames(data)
            if (res.error == true) {
                socket.end()
                socket.destroy(new Error(res.reason))
                return
            }
            if (res.opcode === 'clos') {
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
process.stderr.write(PP.styles.blue + "websocket | Listening on port 80...\n" + PP.styles.none)

server.listen(3003)
process.stderr.write(PP.styles.blue + "https | Listening on port 3003...\n" + PP.styles.none)