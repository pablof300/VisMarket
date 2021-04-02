import schedule from 'node-schedule'
import RedditApi from './redditApi.js';
import RedditCache from './redditCache.js';

// TODO: create redditStream to handle getting streams
// this would be the reddit source

class RedditSource {
    static TUNING_TIME_IN_MINS = 5
    // TODO: Refactor to RedditApi
    static MAX_REQUEST_PER_MINUTE = 60
    static SECONDS_IN_MINUTE = 60

    constructor(subreddits) {
        this.subreddits = subreddits
        this.redditApi = new RedditApi();
        this.cache = new RedditCache(subreddits);
    }

    processAllStreams = async (limit = 25) => {
        this.subreddits.forEach(subredditName => {
            this.processStream(subredditName, 'post', limit)
            this.processStream(subredditName, 'comment', limit)
        })
    }
    
    processStream = async (subredditName, type, limit = 25) => {
        const { cache } = this
        const { filteredStreamData, cacheSize } = cache.filterAndAdd(
            await this.redditApi.fetchData(type, subredditName, limit), subredditName, type)
        console.log(`- Processed ${filteredStreamData.length} records (${type} ~ ${subredditName}) | Cache size: ${cacheSize}`)
        return filteredStreamData.length
    }

    preloadCaches = async () => {
        console.log("* Preloading caches")
        const { processStream } = this;
        await Promise.all(this.subreddits.map(async (subredditName) => {
            await processStream(subredditName, 'post', 100)
            await processStream(subredditName, 'comment', 100)
        }))
    }

    getRecommendedRequestsPerMinute = async () => {
        // TODO: rename this variable
        const overflowProtectionPercentage = 0.25
        const ratePerMinuteBySubreddit = await this.getDataRatesPerMinute();

        const requestsPerMinuteBySubreddit = {}
        
        console.log(ratePerMinuteBySubreddit)

        Object.keys(ratePerMinuteBySubreddit).forEach(subreddit => {
            requestsPerMinuteBySubreddit[subreddit] = {
                post: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].post * (1 + overflowProtectionPercentage) / RedditApi.MAX_REDDIT_LIMIT)),
                comment: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].comment * (1 + overflowProtectionPercentage) / RedditApi.MAX_REDDIT_LIMIT))
            }
        })

        const totalRequestsPerMinute = Object.values(requestsPerMinuteBySubreddit).reduce((accumulator, subredditRates) => accumulator + subredditRates.post + subredditRates.comment, 0)
        const postFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.post, 0))
        const commentFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Object.values(requestsPerMinuteBySubreddit).reduce((total, subredditRates) => total + subredditRates.comment, 0))

        console.log(`* Parameter recommendations based off ${totalRequestsPerMinute} total requests and ${JSON.stringify(requestsPerMinuteBySubreddit)}`)
        console.log(`* Streamer parameter recommendations: (post frequency ~ ${postFrequency}/s) (comment frequency ~ ${commentFrequency})`)

        return { requestsPerMinuteBySubreddit, postFrequency, commentFrequency }
    }

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

    start = async () => {
        const streamerParameters = await this.getRecommendedRequestsPerMinute()

        // schedule.scheduleJob({rule: '*/1 * * * * *' }, function(){
        //     console.log('Time for other tea!');
        // });
    }
}

new RedditSource(['wallstreetbets', 'investing', 'stocks', 'askreddit']).start()