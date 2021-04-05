import schedule from 'node-schedule'
import RedditApi from './redditApi.js';
import RedditCache from './redditCache.js';

// TODO: create redditStream to handle getting streams
// this would be the reddit source

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
        // this.events = events
        this.currentJob = schedule.scheduleJob({rule: '*/1 * * * * *' }, async () => {
            const { secondCounter, processStream } = this
            const currentEvents = events[secondCounter] ? events[secondCounter] : []

            currentEvents.forEach(event => {
                processStream(event.subreddit, event.type, 'stream', 100)
            })

            this.secondCounter = secondCounter > 60 ? 1 : secondCounter + 1
        });
    }

    // getRecommendedRequestsPerMinute = async () => {
    //     // TODO: rename this variable
    //     const overflowProtectionPercentage = 0.25
    //     const ratePerMinuteBySubreddit = await this.getDataRatesPerMinute();

    //     const requestsPerMinuteBySubreddit = {}
    //     Object.keys(ratePerMinuteBySubreddit).forEach(subreddit => {
    //         requestsPerMinuteBySubreddit[subreddit] = {
    //             post: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].post * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_RECORDS_LIMIT)),
    //             comment: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].comment * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_RECORDS_LIMIT))
    //         }
    //     })

    //     const totalRequestsPerMinute = Object.values(requestsPerMinuteBySubreddit).reduce((accumulator, subredditRates) => accumulator + subredditRates.post + subredditRates.comment, 0)
    //     const postFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.post, 0))
    //     const commentFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.comment, 0))

    //     console.log(`* Parameter recommendations based off ${totalRequestsPerMinute} total requests and ${JSON.stringify(requestsPerMinuteBySubreddit)}`)
    //     console.log(`* Streamer parameter recommendations: (post frequency ~ ${postFrequency}/s) (comment frequency ~ ${commentFrequency})`)
    //     return { requestsPerMinuteBySubreddit, postFrequency, commentFrequency }
    // }

    getDataRatesPerMinute = async () => {
        await this.preloadCaches();

        const { subreddits } = this
        const subredditDataCounts = await this.getSubredditDataCounts(subreddits);

        const { dataCountsBySubreddit, postRequestFrequency, commentRequestFrequency } = subredditDataCounts
        const ratePerMinute = {}
        Object.keys(dataCountsBySubreddit).forEach((subreddit) => {
            const currentDataCount = dataCountsBySubreddit[subreddit]
            ratePerMinute[subreddit] =
            {
                post: currentDataCount.post / ((postRequestFrequency * currentDataCount.postRequests) / RedditSource.SECONDS_IN_MINUTE),
                comment: currentDataCount.comment / ((commentRequestFrequency *  currentDataCount.commentRequests) / RedditSource.SECONDS_IN_MINUTE)
            }
        });
        console.log(`* parameter tuning - data counts ${JSON.stringify(dataCountsBySubreddit)}`)
        console.log(`* parameter tuning - rate per minute ${JSON.stringify(ratePerMinute)}`)
        return ratePerMinute
    }

    getSubredditDataCounts = async (subreddits) => {
        const { scheduleSurveyJob } = this
        const numberOfSubreddits = subreddits.length
        return new Promise(function(resolve, reject) {
            // TODO: refactor to concurrent dictionary
            const dataCountsBySubreddit = Object.assign({}, ...subreddits.map((subreddit) => ({[subreddit]: {post: 0, postRequests: 0, comment: 0, commentRequests: 0} })));
            // TODO: rename this variable
            const overflowProtectionPercentage = 0.05
            const maxRequestsPerSubreddit = RedditSource.MAX_REQUEST_PER_MINUTE / numberOfSubreddits

            const postRequestsPercentage = 0.25 - overflowProtectionPercentage
            const postRequestFrequency = Math.ceil(RedditSource.SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * postRequestsPercentage)) 

            const commentsRequestsPercentage = 0.75 - overflowProtectionPercentage
            const commentRequestFrequency = Math.ceil(RedditSource.SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * commentsRequestsPercentage)) 

            console.log(`* parameter tuning - starting schedule parameter tuning with params { posts: ${postRequestFrequency}/s, comments: ${commentRequestFrequency}/s }`)
            const surveyPostsJob = scheduleSurveyJob(postRequestFrequency, dataCountsBySubreddit, subreddits, 'post')
            const surveyCommentsJob = scheduleSurveyJob(commentRequestFrequency, dataCountsBySubreddit, subreddits, 'comment')
            setTimeout(()=> {
                surveyPostsJob.cancel();
                surveyCommentsJob.cancel();
                resolve({dataCountsBySubreddit, postRequestFrequency, commentRequestFrequency})

            }, RedditSource.TUNING_TIME_IN_MINS * RedditSource.SECONDS_IN_MINUTE * 1000);
        });
    }

    scheduleSurveyJob = (frequency, dataCountsBySubreddit, subreddits, type) => {
        const { processStream } = this
        const job = schedule.scheduleJob({rule: `*/${frequency} * * * * *`}, async () => {
            subreddits.forEach(async (subredditName) => {
                dataCountsBySubreddit[subredditName][type] += await processStream(subredditName, type)
                dataCountsBySubreddit[subredditName][type + 'Requests'] += 1
            })  
        });
        return job
    }

    // start = async () => {
    //     const streamerParameters = await this.getRecommendedRequestsPerMinute()

    //     // schedule.scheduleJob({rule: '*/1 * * * * *' }, function(){
    //     //     console.log('Time for other tea!');
    //     // });
    // }
}

export default RedditStreamer;
// new RedditSource(['wallstreetbets', 'investing', 'stocks', 'askreddit']).start()