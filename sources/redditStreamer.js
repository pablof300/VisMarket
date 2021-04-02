import schedule from 'node-schedule'
import RedditApi from './redditApi.js';
import RedditCache from './redditCache.js';

class RedditSource {
    static TUNING_TIME_IN_MINS = 1
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
        Object.keys(ratePerMinuteBySubreddit).forEach(subreddit => {
            requestsPerMinuteBySubreddit[subreddit] = {
                post: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].post * (1 + overflowProtectionPercentage) / RedditSource.MAX_REQUEST_PER_MINUTE)),
                comment: Math.max(1, Math.ceil(ratePerMinuteBySubreddit[subreddit].comment * (1 + overflowProtectionPercentage) / RedditSource.MAX_REQUEST_PER_MINUTE))
            }
        })
        console.log(ratePerMinuteBySubreddit)
        
        const totalRequestsPerMinute = Object.values(requestsPerMinuteBySubreddit).reduce((accumulator, subredditRates) => accumulator + subredditRates.post + subredditRates.comment, 0)
        const postFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Math.max(...Object.values(requestsPerMinuteBySubreddit).map(subredditRates => subredditRates.post)))
        const commentFrequency = Math.floor(RedditSource.SECONDS_IN_MINUTE / Math.max(...Object.values(requestsPerMinuteBySubreddit).map(subredditRates => subredditRates.comment)))

        console.log(totalRequestsPerMinute)
        console.log(postFrequency)
        console.log(commentFrequency)

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
        // const overflowProtectionPercentage = 0.25
        // const ratePerMinuteBySubreddit = await this.getDataRatesPerMinute();

        // const requestsPerMinuteBySubreddit = {}
        // Object.keys(ratePerMinuteBySubreddit).forEach(subreddit => {
        //     requestsPerMinuteBySubreddit[subreddit] = {
        //         post: ratePerMinuteBySubreddit[subreddit].post * (1 + overflowProtectionPercentage) / RedditSource.MAX_REQUEST_PER_MINUTE,
        //         comment: ratePerMinuteBySubreddit[subreddit].comment * (1 + overflowProtectionPercentage) / RedditSource.MAX_REQUEST_PER_MINUTE
        //     }
        // })
        // await this.getRecommendedRequestsPerMinute()
        // console.log("Pickle")
        // console.log(requestsPerMinuteBySubreddit)

        // const postRequestsPerMinute = Math.ceil(Math.max(
        //     ...Object.values(ratePerMinuteBySubreddit).map(rates => rates.post)) * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_PER_MINUTE)
        // const commentRequestsPerMinute = Math.ceil(Math.max(
        //     ...Object.values(ratePerMinuteBySubreddit).map(rates => rates.comment)) * (1 + overflowProtectionPercentage) / RedditApi.MAX_REQUEST_PER_MINUTE)
        

        const job = schedule.scheduleJob({rule: '*/60 * * * * *'}, function(){
            console.log('Time for tea!');
        });

        // schedule.scheduleJob({rule: '*/1 * * * * *' }, function(){
        //     console.log('Time for other tea!');
        // });
        // const subredditName = 'wallstreetbets'
        // cron.schedule('*/60 * * * * *', async () => {
        //     this.processNewPosts(subredditName, RedditSource.MAX_REDDIT_LIMIT).then(newPosts => {
        //         console.log(`Cache size: ${this.postCache.size()}`)
        //         console.log(`RedditStream: ${subredditName} ~ ${newPosts.length} new posts`)
        
        //         newPosts.forEach(post => {
        //             console.log(`# ${post.title}  ${post.id}`)
        //         })
        //     })
        // });

        // const { processStream } = this
        // schedule.scheduleJob({rule: '*/1 * * * * *' }, async () => {
        //     console.log("Started comment stream")
        //     await processStream('wallstreetbets', 'comment', RedditSource.MAX_REDDIT_LIMIT);
        // });
    }
}

new RedditSource(['wallstreetbets', 'investing', 'stocks', 'askreddit']).start()