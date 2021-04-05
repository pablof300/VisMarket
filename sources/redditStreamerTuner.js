import RedditApi from "./redditApi.js";

class RedditStreamerTunner {
    static DEFAULT_TUNING_TIME_IN_MINS = 5
    static SECONDS_IN_MINUTE = 60

    constructor(subreddits) {
        this.subreddits = subreddits
        this.requestCounter = 0
        // numberOfRequestsBySubreddit represents number of requests per minute needed to fulfill demand
        this.numberOfRequestsBySubreddit = this.initializeNumberOfRequestsBySubreddit(0, 0)
    }

    getInitialStreamerEvents = () => {
        const numberOfSubreddits = this.subreddits.length
        const overflowProtectionPercentage = 0.05
        const postRequestsPerMinute = Math.floor((0.25 - overflowProtectionPercentage) * RedditApi.MAX_REQUEST_PER_MINUTE)
        const commentRequestsPerMinute = Math.floor((0.75 - overflowProtectionPercentage) * RedditApi.MAX_REQUEST_PER_MINUTE)

        const postRequestsPerSubreddit = Math.floor(postRequestsPerMinute / numberOfSubreddits)
        const commentRequestsPerSubreddit = Math.floor(commentRequestsPerMinute / numberOfSubreddits)

        const numberOfRequestsBySubreddit = this.initializeNumberOfRequestsBySubreddit(postRequestsPerSubreddit, commentRequestsPerSubreddit)
        return this.getStreamerEvents(numberOfRequestsBySubreddit)
    }

    initializeNumberOfRequestsBySubreddit = (initialPostValue, initialCommentValue) => {
        const numberOfRequestsBySubreddit = {}
        this.subreddits.forEach(subreddit => {
            numberOfRequestsBySubreddit[subreddit] = { post: initialPostValue, comment: initialCommentValue }
        })
        return numberOfRequestsBySubreddit
    }

    getStreamerEvents = (numberOfRequestsBySubreddit) => {
        console.log(`(StreamerTuner) - optimizing second buckets for ${JSON.stringify(numberOfRequestsBySubreddit)}`)
        this.totalRequests = Object.values(numberOfRequestsBySubreddit).reduce((accumulator, subreddit) => accumulator + subreddit.post + subreddit.comment, 0)
        const postFrequency = Math.ceil(RedditStreamerTunner.SECONDS_IN_MINUTE / Object.values(numberOfRequestsBySubreddit).reduce((accumulator, subreddit) => accumulator + subreddit.post, 0))
        const commentFrequency = Math.ceil(RedditStreamerTunner.SECONDS_IN_MINUTE / Object.values(numberOfRequestsBySubreddit).reduce((accumulator, subreddit) => accumulator + subreddit.comment, 0))
        const { postTriggerBuckets, commentTriggerBuckets } = this.getTriggerSeconds(postFrequency, commentFrequency)

        console.log(`(StreamerTuner) - post frequency: ${postFrequency}, post buckets: ${postTriggerBuckets.length}, max: ${Math.max(...Object.values(numberOfRequestsBySubreddit).map(subreddit => subreddit.post))})`)
        console.log(`(StreamerTuner) - comment frequency: ${commentFrequency}, post buckets: ${commentTriggerBuckets.length}, max: ${Math.max(...Object.values(numberOfRequestsBySubreddit).map(subreddit => subreddit.comment))})`)

        const events = {}
        new Set(postTriggerBuckets.concat(commentTriggerBuckets)).forEach(secondBucket => {
            events[secondBucket] = []
        })

        const subredditNames = Object.keys(numberOfRequestsBySubreddit)
        let currentBucket = { post: 0, comment: 0 }
        while (Object.keys(subredditNames).length !== 0) {
            for (let subredditIndex = subredditNames.length - 1; subredditIndex >= 0; subredditIndex--) {
                const currentSubredditName = subredditNames[subredditIndex]
                const currentSubreddit = numberOfRequestsBySubreddit[currentSubredditName]
                if (currentSubreddit.post !== 0) {
                    events[postTriggerBuckets[currentBucket.post]].push({type: 'post', subreddit: currentSubredditName})
                    currentSubreddit.post -= 1
                    currentBucket.post += 1
                }
                if (currentSubreddit.comment !== 0) {
                    events[commentTriggerBuckets[currentBucket.comment]].push({type: 'comment', subreddit: currentSubredditName})
                    currentSubreddit.comment -= 1
                    currentBucket.comment += 1
                }
                if (currentBucket.post === postTriggerBuckets.length) {
                    currentBucket.post = 0
                }
                if (currentBucket.comment === commentTriggerBuckets.length) {
                    currentBucket.comment = 0
                }
                if (currentSubreddit.post === 0 && currentSubreddit.comment === 0) {
                    this.removeFromArray(subredditNames, currentSubredditName)
                }
            }
        }
        console.log(`(StreamerTuner) - Scheduler events:`)
        console.log(events)
        return events
    }

    removeFromArray(array, value) {
        array.splice(array.indexOf(value),1)
    }

    getTriggerSeconds = (postFrequency, commentFrequency) => {
        const postTriggerBuckets = []
        const commentTriggerBuckets = []

        let currentSecond;
        for (currentSecond = postFrequency; currentSecond <= RedditStreamerTunner.SECONDS_IN_MINUTE; currentSecond += postFrequency) {
            postTriggerBuckets.push(currentSecond) 
        }
        for (currentSecond = commentFrequency; currentSecond <= RedditStreamerTunner.SECONDS_IN_MINUTE; currentSecond += commentFrequency) {
            commentTriggerBuckets.push(currentSecond) 
        }

        return { postTriggerBuckets, commentTriggerBuckets }
    }

    // getInitialRequestFrequency = (overflowProtectionPercentage, percentageOfTotalRequests) => {
    //     const maxRequestsPerSubreddit = RedditApi.MAX_REQUEST_PER_MINUTE / this.subreddits.length
    //     const adjustedRequestsPercentage = percentageOfTotalRequests - overflowProtectionPercentage


    //     return Math.ceil(RedditStreamerTunner.SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * adjustedRequestsPercentage)) 
    // }

    // getRecommendedSchedulerParameters = async () => {
    //     const dataCountsBySubreddit = Object.assign({}, ...subreddits.map((subreddit) => ({[subreddit]: {post: 0, postRequests: 0, comment: 0, commentRequests: 0} })));
        
    // }

    optimizeEvents = (callback) => {
        // TODO: refactor to promise?
        this.streamerCallback = callback
    }

    handleDataStream = (data) => {
        const { numberOfRequestsBySubreddit } = this
        numberOfRequestsBySubreddit[data.subredditName][data.type] += data.records.length
        this.requestCounter += 1
        if (this.requestCounter === this.totalRequests) {
            const overflowProtectionPercentage = 0.25
            Object.keys(numberOfRequestsBySubreddit).forEach(subredditName => {
                const currentSubreddit = numberOfRequestsBySubreddit[subredditName]
                currentSubreddit.post = Math.max(1, Math.ceil(currentSubreddit.post * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_RECORDS_LIMIT))
                currentSubreddit.comment = Math.max(1, Math.ceil(currentSubreddit.comment * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_RECORDS_LIMIT))
            })
            // console.log("STOP")
            // console.log(numberOfRequestsBySubreddit)
            this.streamerCallback(this.getStreamerEvents(numberOfRequestsBySubreddit))
        }
        // console.log(`Request counter ${this.requestCounter}`)
    }

    // getRecommendedRequestsPerMinute = async () => {
    //     // TODO: rename this variable
    //     const overflowProtectionPercentage = 0.25
    //     const ratePerMinuteBySubreddit = await this.getDataRatesPerMinute();

    //     const requestsPerMinuteBySubreddit = {}
    //     Object.keys(ratePerMinuteBySubreddit).forEach(subreddit => {
    //         requestsPerMinuteBySubreddit[subreddit] = {
    //             post: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].post * (1 + overflowProtectionPercentage) / RedditApi.MAX_REDDIT_LIMIT)),
    //             comment: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].comment * (1 + overflowProtectionPercentage) / RedditApi.MAX_REDDIT_LIMIT))
    //         }
    //     })

    //     const totalRequestsPerMinute = Object.values(requestsPerMinuteBySubreddit).reduce((accumulator, subredditRates) => accumulator + subredditRates.post + subredditRates.comment, 0)
    //     const postFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.post, 0))
    //     const commentFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.comment, 0))

    //     console.log(`* Parameter recommendations based off ${totalRequestsPerMinute} total requests and ${JSON.stringify(requestsPerMinuteBySubreddit)}`)
    //     console.log(`* Streamer parameter recommendations: (post frequency ~ ${postFrequency}/s) (comment frequency ~ ${commentFrequency})`)
    //     return { requestsPerMinuteBySubreddit, postFrequency, commentFrequency }
    // }

    // getDataRatesPerMinute = async () => {
    //     const { subreddits } = this
    //     const subredditDataCounts = await this.getSubredditDataCounts(subreddits);

    //     const { dataCountsBySubreddit, postRequestFrequency, commentRequestFrequency } = subredditDataCounts
    //     const ratePerMinute = {}
    //     Object.keys(dataCountsBySubreddit).forEach((subreddit) => {
    //         const currentDataCount = dataCountsBySubreddit[subreddit]
    //         ratePerMinute[subreddit] =
    //         {
    //             post: currentDataCount.post / ((postRequestFrequency * currentDataCount.postRequests) / RedditSource.SECONDS_IN_MINUTE),
    //             comment: currentDataCount.comment / ((commentRequestFrequency *  currentDataCount.commentRequests) / RedditSource.SECONDS_IN_MINUTE)
    //         }
    //     });
    //     console.log(`* parameter tuning - data counts ${JSON.stringify(dataCountsBySubreddit)}`)
    //     console.log(`* parameter tuning - rate per minute ${JSON.stringify(ratePerMinute)}`)
    //     return ratePerMinute
    // }

    // getSubredditDataCounts = async (subreddits) => {
    //     const { scheduleSurveyJob } = this
    //     const numberOfSubreddits = subreddits.length
    //     return new Promise(function(resolve, reject) {
    //         // TODO: refactor to concurrent dictionary
    //         const dataCountsBySubreddit = Object.assign({}, ...subreddits.map((subreddit) => ({[subreddit]: {post: 0, postRequests: 0, comment: 0, commentRequests: 0} })));
    //         // TODO: rename this variable
    //         const overflowProtectionPercentage = 0.05
    //         const maxRequestsPerSubreddit = RedditSource.MAX_REQUEST_PER_MINUTE / numberOfSubreddits

    //         const postRequestsPercentage = 0.25 - overflowProtectionPercentage
    //         const postRequestFrequency = Math.ceil(RedditSource.SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * postRequestsPercentage)) 

    //         const commentsRequestsPercentage = 0.75 - overflowProtectionPercentage
    //         const commentRequestFrequency = Math.ceil(RedditSource.SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * commentsRequestsPercentage)) 

    //         console.log(`* parameter tuning - starting schedule parameter tuning with params { posts: ${postRequestFrequency}/s, comments: ${commentRequestFrequency}/s }`)
    //         const surveyPostsJob = scheduleSurveyJob(postRequestFrequency, dataCountsBySubreddit, subreddits, 'post')
    //         const surveyCommentsJob = scheduleSurveyJob(commentRequestFrequency, dataCountsBySubreddit, subreddits, 'comment')
    //         setTimeout(()=> {
    //             surveyPostsJob.cancel();
    //             surveyCommentsJob.cancel();
    //             resolve({dataCountsBySubreddit, postRequestFrequency, commentRequestFrequency})

    //         }, RedditSource.TUNING_TIME_IN_MINS * RedditSource.SECONDS_IN_MINUTE * 1000);
    //     });
    // }

    // scheduleSurveyJob = (frequency, dataCountsBySubreddit, subreddits, type) => {
    //     const { processStream } = this
    //     const job = schedule.scheduleJob({rule: `*/${frequency} * * * * *`}, async () => {
    //         subreddits.forEach(async (subredditName) => {
    //             dataCountsBySubreddit[subredditName][type] += await processStream(subredditName, type)
    //             dataCountsBySubreddit[subredditName][type + 'Requests'] += 1
    //         })  
    //     });
    //     return job
    // }
}

export default RedditStreamerTunner;