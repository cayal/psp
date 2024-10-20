import { format } from "util"

export const L = (() => {
    async function* write() {
        let nextOut: string
        while (true) {
            if (nextOut = yield) {
                process.stderr.write(nextOut)
            }
        }
    }

    let writer = write()
    writer.next()
    writer.next('Logger initialized.\n')

    return {
        log: async (...a) => {
            const s = a.map(aa => typeof aa !== 'string' ? format(aa) : a)
            writer.next(s.join('\t'))
        },

        error: async (...a) => {
            const s = a.map(aa => typeof aa !== 'string' ? format(aa) : a)
            writer.next('\x1b[31m' + s.join('\t') + '\x1b[0m')
        },

        warn: async (...a) => {
            const s = a.map(aa => typeof aa !== 'string' ? format(aa) : a)
            writer.next('\x1b[33m' + s.join('\t') + '\x1b[0m')
        }
    }
})()