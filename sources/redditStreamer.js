import schedule from 'node-schedule'
import RedditApi from './redditApi.js';
import RedditCache from './redditCache.js'

class RedditStreamer {
    constructor(subreddits) {
        this.subreddits = subreddits
        this.redditApi = new RedditApi();
        this.cache = new RedditCache(subreddits);
        this.suscribers = []
        this.secondCounter = 0
    }

    suscribe = (suscriberName, events, callback) => {
        this.suscribers.push({name: suscriberName, callback, events})
    }

    unsuscribe = (suscriberName) => {
        this.suscribers = this.suscribers.filter(suscriber => suscriber.name !== suscriberName)
    }

    publish = (data, event) => {
        this.suscribers.forEach(suscriber => {
            if (suscriber.events === 'all' || suscriber.events.includes(event)) {
                suscriber.callback(data)
            }
        })
    }
    
    processStream = async (subredditName, type, event, limit = 25) => {
        const { cache } = this
        const { filteredStreamData, cacheSize } = cache.filterAndAdd(
            await this.redditApi.fetchData(type, subredditName, limit), subredditName, type)
        console.log(`- Streamed ${filteredStreamData.length} records (${type} ~ ${subredditName}) | Cache size: ${cacheSize}`)
        this.publish({records: filteredStreamData, subredditName, type}, event)
    }

    preloadCaches = async () => {
        console.log("* Preloading caches")
        const { processStream } = this;
        await Promise.all(this.subreddits.map(async (subredditName) => {
            await processStream(subredditName, 'post', 'preload', 100)
            await processStream(subredditName, 'comment', 'preload', 100)
        }))
    }

    init = async (tuner) => {
        await this.preloadCaches();
        this.startStreamer(tuner.getInitialStreamerEvents())
        tuner.optimizeEvents((events) => { 
            this.unsuscribe('tuner')
            this.startStreamer(events)
        })
    }

    startStreamer = (events) => {
        const { currentJob } = this
        if (currentJob) {
            currentJob.cancel()
        }

        this.currentJob = schedule.scheduleJob({rule: '*/1 * * * * *' }, async () => {
            const { secondCounter, processStream } = this
            const currentEvents = events[secondCounter] ? events[secondCounter] : []

            currentEvents.forEach(event => {
                processStream(event.subreddit, event.type, 'stream', 100)
            })

            this.secondCounter = secondCounter > 60 ? 1 : secondCounter + 1
        });
    }
}

export default RedditStreamer;