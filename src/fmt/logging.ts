import { format } from "util"

export const L = (() => {
    async function* write() {
        let nextOut: string
        while (true) {
            if (nextOut = yield) {
                if (typeof nextOut !== 'string') {
                    nextOut = format(nextOut)
                }
                process.stderr.write(nextOut)
            }
        }
    }
    
    let writer = write()
    writer.next()
    writer.next('Logger initialized.\n')

    return {
        log: async (...s) => { 
            writer.next(s.join('\t'))
        }
    }
})()