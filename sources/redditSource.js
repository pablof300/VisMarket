import cron from 'node-cron'
import RedditApi from './redditApi.js';

class RedditSource {

    constructor() {
        this.postCache = new OrderedDict();
        this.commentCache = new OrderedDict();
        this.redditApi = new RedditApi();
    }

    processNewPosts = async (subredditName, limit = 25) => {
        const { postCache } = this


        const redditPosts = await this.fetchNewPosts(subredditName, limit)
        const newRedditPosts = redditPosts.filter(post => !postCache.has(post.id))
    
        newRedditPosts.forEach(post => {
            postCache.append(post.id, undefined)
            if (postCache.size() >= RedditSource.CACHE_SIZE) {
                postCache.remove(postCache.first())
            }
        })
    
        return newRedditPosts
    }

    processNewComments = async (subredditName, limit = 25) => {
        const { commentCache } = this

        const redditPosts = await this.redditApi.fetchData('comment', subredditName, limit)
        const newRedditPosts = redditPosts.filter(post => !commentCache.has(post.id))
    
        newRedditPosts.forEach(post => {
            commentCache.append(post.id, undefined)
            if (commentCache.size() >= RedditSource.CACHE_SIZE) {
                commentCache.remove(commentCache.first())
            }
        })
    
        return newRedditPosts
    }

    start = async () => {
        const subredditName = 'wallstreetbets'
        cron.schedule('*/60 * * * * *', async () => {
            this.processNewPosts(subredditName, RedditSource.MAX_REDDIT_LIMIT).then(newPosts => {
                console.log(`Cache size: ${this.postCache.size()}`)
                console.log(`RedditStream: ${subredditName} ~ ${newPosts.length} new posts`)
        
                newPosts.forEach(post => {
                    console.log(`# ${post.title}  ${post.id}`)
                })
            })
        });
        cron.schedule('*/3 * * * * *', async () => {
            console.log("Started comment stream")
            this.processNewComments(subredditName, RedditSource.MAX_REDDIT_LIMIT).then(newComments => {
                console.log(`Cache size: ${this.commentCache.size()}`)
                console.log(`RedditStream: ${subredditName} ~ ${newComments.length} new comments`)
        
                newComments.forEach(post => {
                    console.log(`# ${post.body} ${post.id}`)
                })
            })
        });
    }
}

new RedditSource().start()