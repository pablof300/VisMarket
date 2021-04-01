import schedule from 'node-schedule'
import RedditApi from './redditApi.js';
import RedditCache from './redditCache.js';

class RedditSource {
    static TUNING_TIME_IN_MINS = 5
    static MAX_REQUEST_PER_MINUTE = 60

    constructor(subreddits) {
        this.subreddits = subreddits
        this.redditApi = new RedditApi();
        this.cache = new RedditCache(subreddits);
    }

    processNewPosts = async (subredditName, limit = 25) => {
        const { cache } = this

        return cache.filterAndAdd(
            await this.redditApi.fetchData('post', subredditName, limit), subredditName, 'post')

        // const newRedditPosts = redditPosts.filter(post => !postCache.has(post.id))
    
        // newRedditPosts.forEach(post => {
        //     postCache.append(post.id, undefined)
        //     if (postCache.size() >= RedditSource.CACHE_SIZE) {
        //         postCache.remove(postCache.first())
        //     }
        // })
    
        // return newRedditPosts
    }

    processNewComments = async (subredditName, limit = 25) => {
        const { cache } = this

        console.log((await this.redditApi.fetchData('comment', subredditName, limit)).length)

        return cache.filterAndAdd(
            await this.redditApi.fetchData('comment', subredditName, limit), subredditName, 'comment')
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

    performSchedulerParameterTuning = async () => {
        const { subreddits, processStream } = this
        const numberOfSubreddits = subreddits.length
        const tuningResults = await new Promise(function(resolve, reject) {
            // TODO: refactor to concurrent dictionary
            const SECONDS_IN_MINUTE = 60
            const numberOfEntriesBySubreddit = Object.assign({}, ...subreddits.map((subreddit) => ({[subreddit]: {post: 0, postRequests: 0, comment: 0, commentRequests: 0} })));
            const overflowSafetyPercentage = 0.05
            const maxRequestsPerSubreddit = RedditSource.MAX_REQUEST_PER_MINUTE / numberOfSubreddits

            const postRequestsPercentage = 0.25 - overflowSafetyPercentage
            const postScheduleRule = Math.ceil(SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * postRequestsPercentage)) 

            const commentsRequestsPercentage = 0.75 - overflowSafetyPercentage
            const commentScheduleRule = Math.ceil(SECONDS_IN_MINUTE / (maxRequestsPerSubreddit * commentsRequestsPercentage)) 

            console.log(`* Starting schedule parameter tuning with params { posts: ${postScheduleRule}/s, comments: ${commentScheduleRule}/s }`)
            const tuningPostsJob = schedule.scheduleJob({rule: `*/${postScheduleRule} * * * * *`}, async () => {
                subreddits.forEach(async (subredditName) => {
                    numberOfEntriesBySubreddit[subredditName]['post'] += await processStream(subredditName, 'post')
                    numberOfEntriesBySubreddit[subredditName]['postRequests'] += 1
                })  
            });
            const tuningCommentsJob = schedule.scheduleJob({rule: `*/${commentScheduleRule} * * * * *`}, async () => {
                subreddits.forEach(async (subredditName) => {
                    numberOfEntriesBySubreddit[subredditName]['comment'] += await processStream(subredditName, 'comment')
                    numberOfEntriesBySubreddit[subredditName]['commentRequests'] += 1
                })  
            });
            setTimeout(()=> {
                tuningPostsJob.cancel();
                tuningCommentsJob.cancel();
                resolve({numberOfEntriesBySubreddit, postScheduleRule, commentScheduleRule})

            }, RedditSource.TUNING_TIME_IN_MINS * SECONDS_IN_MINUTE * 1000);
        });

        console.log('Number of entries by subreddit ~ 1 minute')
        console.log(tuningResults)
    }

    start = async () => {
        await this.preloadCaches();
        await this.performSchedulerParameterTuning();

        // const job = schedule.scheduleJob({rule: '*/1 * * * * *'}, function(){
        //     console.log('Time for tea!');
        // });

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

        // cron.schedule('*/3 * * * * *', async () => {
        //     console.log("Started comment stream")
        //     this.processNewComments(subredditName, RedditSource.MAX_REDDIT_LIMIT).then(newComments => {
        //         // console.log(`Cache size: ${this.commentCache.size()}`)
        //         console.log(`RedditStream: ${subredditName} ~ ${newComments.length} new comments`)
        
        //         newComments.forEach(post => {
        //             console.log(`# ${post.body} ${post.id}`)
        //         })
        //     })
        // });
    }
}

new RedditSource(['wallstreetbets', 'investing', 'stocks']).start()