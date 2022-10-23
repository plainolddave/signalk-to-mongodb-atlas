const superagent = require('superagent')


const settings = {
    housekeepingMillis: 30000,  // time between performing regular housekeeping tasks
    responseMillis: 10000,      // allow 10 seconds for the server to start sending
    deadlineMillis: 25000,      // allow 25 seconds for the response to finish
    defaultTtlMillis: 60000     // time-to-live in milliseconds - data older then this will be removed from the buffer
};


class MongoDb {

    buffer = new Map();         // buffer to store data points before transmitting to MongoDB 
    options = null;             // object to store the options for later on
    app = null;                 // object to store the app for later on
    timer = null;               // timer to periodically perform housekeeping
    flushExpiry = new Date();   // next time that the buffer should be flushed
    flushMillis = 0;            // maximum interval between flushing the buffer
    ttlMillis = settings.defaultTtlMillis;  // time-to-live in milliseconds - data older then this will be removed from the buffer
    flushing = false;           // flag to indicate the bufer is being flushed to Mongo

    constructor(app) {
        this.app = app;         // store the original app object for later on 
    };

    start(options) {

        this.app.debug(`mongodb options: ${JSON.stringify(options)}`);
        this.options = options;
        if (options.ttlSecs != null) {
            this.ttlMillis = options.ttlSecs * 1000;
        }

        // set up a trigger to periodically flush the buffer
        if (this.options.flushSecs != null) {
            if (this.options.flushSecs > 0) {
                this.flushMillis = this.options.flushSecs * 1000;
                this.flushExpiry = new Date(new Date().getTime() + this.flushMillis);
            }
        }

        // create a timer to periodically perform housekeeping
        this.timer = setInterval(this.housekeeping, options.housekeepingMillis);
    }

    stop() {

        // flush the buffer
        this.flush();

        // clear the timer
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }

    // add fields to the data point needed to buffer it for sending
    getPoint = (point) => {
        try {

            // timestamp of the payload data (i.e. the time the data was 
            // collected, or use the current time if data.time is missing)
            if (point.time == null) {
                point.time = new Date();
            }

            // time at which the payload automatically expires
            point.expiry = new Date(new Date().getTime() + this.ttlMillis);

            // create a simple 64 bit hash
            let json = JSON.stringify(point);
            let i = json.length
            let hash1 = 5381    
            let hash2 = 52711
            while (i--) {
                const c = json.charCodeAt(i)
                hash1 = (hash1 * 33) ^ c
                hash2 = (hash2 * 33) ^ c
            }
            point.uid = (hash1 >>> 0) * 4096 + (hash2 >>> 0)
            //point.uid = require('crypto').createHash('md5').update(JSON.stringify(point)).digest("hex");
            return point;

        } catch (err) {
            this.app.error(`point: ${err}`);
            return null;
        }
    };

    // buffer data to be sent 
    send = (point) => {

        try {
            // check for excess messages 
            if (this.buffer.size >= this.options.maxBuffer) {
                throw `buffer exceeded: ${this.buffer.size}`;
            }

            // create the datapoint to buffer
            point = this.getPoint(point);

            // add the data message to the buffer
            this.buffer.set(point.uid, point);

            // if the nominal batch size is reached, or if the 
            // buffer hasn't been flushed recently, then flush
            const timeNow = new Date();
            if (this.buffer.size >= this.options.batchSize || timeNow > this.flushExpiry) {
                this.flush();
            }

        } catch (err) {
            this.app.error(`send: ${err}`);
        }
    }

    // periodically perform housekeeping
    housekeeping = () => {

        // check for stale entries - this should only apply if data is
        // cached because sending was unsuccessful for some reason
        const timeNow = new Date();
        for (const [key, point] of this.buffer) {
            if (timeNow > point.expiry) {
                this.buffer.delete(key);
            }
        }

        // if the buffer hasn't been flushed recently, clear it out
        if (timeNow > this.flushExpiry) {
            this.flush();
        }
    }


    // attempt to send batches of data
    flush = async () => {

        // check if a flush is already in progress
        if (this.flushing === true) return;

        try {

            this.flushing = true;

            // is this a full or partial flush?
            let batches = Math.floor(this.buffer.size / this.options.batchSize);
            if (new Date() > this.flushExpiry) {
                batches++;
            }

            // split the buffer into batches of records to send
            const bufferIterator = this.buffer.entries();
            while (batches--) {

                // create the batch to send
                let duration = new Date().getTime();
                let batch = [];
                let c = this.options.batchSize;

                while (c--) {
                    let point = bufferIterator.next().value;
                    if (point == null || point == undefined) break;
                    batch.push(point[1]);
                }

                // send the batch to MongoDB and clean up when its done
                // https://visionmedia.github.io/superagent/
                let result = await superagent
                    .put(this.options.apiUrl)
                    .set('Content-Type', 'application/json')
                    .set('accept', 'json')
                    .set('api-key', this.options.apiKey)
                    .retry(2)
                    .timeout({
                        response: settings.responseMillis, // time for the server to start sending
                        deadline: settings.deadlineMillis, // deadline for the response to finish
                    })
                    .send(batch);

                duration = new Date().getTime() - duration;
                this.app.debug(`sent ${batches}: ${batch.length} of ${this.buffer.size} points in ${duration} msec status: ${result.status} reply: ${result.text}`);

                // if successful, clear the sent items from the buffer
                if (result.status >= 200 && result.status < 300) {
                    batch.forEach(point => {
                        this.buffer.delete(point.uid);
                    });
                } else {
                    this.app.error(`agent error: ${JSON.stringify(error)} result: ${JSON.stringify(result)}`);
                }
            }
        } catch (err) {
            this.app.error(`flush: ${err}`);

        } finally {

            // reset the flush expiry
            this.flushExpiry = new Date(new Date().getTime() + this.flushMillis);
            this.flushing = false;
        }
    }
}

module.exports = {
    MongoDb
};