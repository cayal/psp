import { PukableEntrypoint } from "../pukables/entrypoints"
import { MessagePort } from "worker_threads"
import { L } from "../fmt/logging"
import { Socket } from "net"

const DEBUG_TIMEOUTS = false
const DEBUG_CONNECTIONS = false

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
* @param {string} message  Text data to encode
* @returns {Uint8Array} Message wrapped as a 1-frame WS message
*/
export function prepareFrame(message: string): Uint8Array {
    const thisisMyFinalFrame = 0b10000000
    const byte1 = thisisMyFinalFrame | wsOps.dtxt
    let msg = Enc.encode(message)
    if (msg.byteLength > 125) {
        console.warn(`Message too long and will be truncated: ${message}`)
        msg = msg.slice(0, 125)
    }
    const isUnmasked = 0b01111111
    const byte2 = isUnmasked & msg.byteLength

    return Uint8Array.from([byte1, byte2, ...msg])
}


let pingCtr = 0
export function pingFrame(socketId: number) {
    const thisisMyFinalFrame = 0b10000000
    const byte1 = thisisMyFinalFrame | wsOps.ping

    const byte2 = 1
    if (DEBUG_TIMEOUTS) { console.log("ping counter: " , pingCtr) }
    const endByte = (pingCtr++) % 256

    return Uint8Array.from([byte1, byte2, endByte])
}

export function pongFrame(data: number[]) {
    let bytes = Uint8Array.from(data)
    bytes[0] = bytes[0] & 0b11110000
    bytes[0] = bytes[0] | wsOps.pong

    return Uint8Array.from(bytes)
}

export type WSDecodeRes = { opcode: keyof WSOpcode, data?: string | number[], error: false } | { error: true, reason: string }
export function decodeFrames(message: Buffer): WSDecodeRes {
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

export function WSChangeset(changeReceiver: MessagePort) {
    let _interval = 1000
    let _deadline = 3000
    let _nextSid = 0

    const buildListeners: {
        sk: Socket,
        cb: (_: Event) => void,
        timerId?: number,
        lastPingValue?: number,
        lastPongTime: number
    }[] = []

    return {
        listeners: buildListeners,
        startPings: _startPings,
        keepalive: _keepalive,
        addSocket: _addSocket
    }
    
    function _startPings(id: number) {
        if (!buildListeners[id]) { 
            console.error(`No socket ${id} for which to start pings.`)
            return 
        }
        
        if (DEBUG_TIMEOUTS) {
            console.debug('id: ', id)
            console.debug('interval: ', _interval)
            console.debug('deadline: ', _deadline)
        }
        
        let {sk, lastPongTime, timerId} = buildListeners[id]

        if (DEBUG_TIMEOUTS) {
            console.debug('lastPongTime: ', lastPongTime)
            console.debug('lastPingValue: ', buildListeners[id].lastPingValue)
        }

        if ((Date.now() - lastPongTime) > (_interval + _deadline)) {
            if (DEBUG_TIMEOUTS) {
                L.log(`(Sock#${id}) | Timed out: ${Date.now() - lastPongTime}. Stopping pings. \n`)
            }
            clearTimeout(timerId)
            sk.destroy()
            return

        } else {
            let nextPing = pingFrame(id)
            buildListeners[id].lastPingValue = nextPing[2]
            sk.write(nextPing)
            buildListeners[id].timerId = setTimeout(_startPings, _interval, id, _interval, _deadline)
        }
    }
    
    function _keepalive(id, pongData: number[]) {

        if (!buildListeners[id]) { 
            console.error(`No socket ${id} to keep alive.`)
            return 
        }

        if (!(buildListeners[id].lastPingValue)
            || (pongData[0] === buildListeners[id].lastPingValue)) {
            if (DEBUG_TIMEOUTS) { console.debug(`Setting pong time...`) }
            buildListeners[id].lastPongTime = Date.now()
        }
    }

    function _addSocket(socket: Socket & {id?: number}, relpathsToPukers: {[rp: string]: PukableEntrypoint[]}) {
        for (let i = 0; i < buildListeners.length; i++) {
            const { sk, cb, lastPongTime } = buildListeners[i]
            if (sk.destroyed || ((Date.now() - lastPongTime) > (_interval + _deadline))) {
                changeReceiver.removeEventListener("message", cb)
            }
        }

        if (!socket.id) { socket.id = _nextSid++ }
        if (DEBUG_CONNECTIONS) {
            L.log(`(Sock#${socket.id}) | Created build listener.\n`)
        }

        if (!buildListeners[socket.id]) {
            buildListeners[socket.id] = {
                lastPongTime: Date.now(),
                sk: socket,
                cb: (ev: Event & { data: string }) => {
                    let [mode, pName] = ev.data.split(" ")

                    if (DEBUG_CONNECTIONS) { L.log(`(Sock#${socket.id}) | Received ${ev.data} event.\n`) }

                    if (mode == "built") {
                        const pukerDatas = relpathsToPukers[pName]
                        for (let p of pukerDatas) {
                            let wp = `changed ${p.ownLink.webpath}`

                            if (DEBUG_CONNECTIONS) { L.log(`(Sock#${socket.id}) | -> '${wp}'\n`) }

                            socket.write(prepareFrame(wp))
                        }
                    }
                }
            }

            changeReceiver.addEventListener("message", buildListeners[socket.id].cb)
        }
    }
}