import fetch from 'node-fetch';
import cron from 'node-cron'
import OrderedDict from 'ordered-dict'

const MAX_REDDIT_LIMIT = 100
const CACHE_SIZE = 200
const postCache = new OrderedDict();

const processNewPosts = async (subredditName, limit = 25) => {
    const redditPosts = await fetchNewPosts(subredditName, limit)
    const newRedditPosts = redditPosts.filter(post => !postCache.has(post.id))

    newRedditPosts.forEach(post => {
        postCache.append(post.id, undefined)
        if (postCache.size() >= CACHE_SIZE) {
            postCache.remove(postCache.first())
        }
    })

    return newRedditPosts
}

const fetchNewPosts = async (subredditName, limit) => {
    const response = await fetch(`https://www.reddit.com/r/${subredditName}/new.json?sort=new&show=all&limit=${limit}`);
    const body = await response.text();
    return JSON.parse(body).data.children.map(post => post.data);
}

// const recordPosts = (posts) => {
//     return posts.filter(post => recordPost(post))
// }

// const recordPost = (post) => {
//     if (!postCache.has(post.id)) {
//         postCache.set(post.id, undefined)
//         return true
//     }
//     return false
// }

const subredditName = 'askreddit'

cron.schedule('*/5 * * * * *', async () => {
    processNewPosts(subredditName).then(newPosts => {
        console.log(`Cache size: ${postCache.size()}`)
        console.log(`RedditStream: ${subredditName} ~ ${newPosts.length} new posts`)

        newPosts.forEach(post => {
            console.log(`# ${post.title}  ${post.id}`)
        })
    })
});