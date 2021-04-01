import OrderedDict from 'ordered-dict'

class RedditCache {
    static MAX_CACHE_SIZE = 301

    constructor(subreddits) {
        this.allCaches = Object.assign({}, ...subreddits.map(
            (subreddit) => ({[subreddit]: { comment: new OrderedDict(), post: new OrderedDict() } }))
        );
    }

    add = (id, subreddit, type) => {
        const currentCache = this.allCaches[subreddit][type]
        currentCache.append(id, undefined)
        if (currentCache.size() >= RedditCache.MAX_CACHE_SIZE) {
            currentCache.remove(currentCache.first())
        }
    }

    filterAndAdd = (data, subreddit, type) => {
        const currentCache = this.allCaches[subreddit][type]
        const filteredStreamData = data.filter(dataPoint => !currentCache.has(dataPoint.id))
        filteredStreamData.forEach(dataPoint => this.add(dataPoint.id, subreddit, type))
        return { filteredStreamData, cacheSize: currentCache.size()}
    }
}

export default RedditCache