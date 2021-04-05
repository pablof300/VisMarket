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

    optimizeEvents = (callback) => {
        // TODO: refactor to promise
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
            this.streamerCallback(this.getStreamerEvents(numberOfRequestsBySubreddit))
        }
    }
}

export default RedditStreamerTunner;