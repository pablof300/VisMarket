import OrderedDict from 'ordered-dict'

class RedditCache {
    static MAX_CACHE_SIZE = 301

    constructor(subreddits) {
        this.allCaches = Object.assign({}, ...subreddits.map(
            (subreddit) => ({[subreddit]: { comments: new OrderedDict(), posts: new OrderedDict() } }))
        );
    }

    add = (id, subreddit, type) => {
        const currentCache = this.allCaches[subreddit][type]
        currentCache.append(id, undefined)
        if (currentCache.size() >= RedditCache.MAX_CACHE_SIZE) {
            currentCache.remove(currentCache.first())
        }
    }

    addMany = (ids, subreddit, type) => {
        const currentCache = this.allCaches[subreddit][type]
        const filteredIds = ids.filter(id => !currentCache.has(id))
        filteredIds.forEach(id => this.add(id, subreddit, type))
    }
}

export default RedditCache