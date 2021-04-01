import fetch from 'node-fetch';

class RedditApi {
    static MAX_REDDIT_LIMIT = 100
    static baseUrl = 'https://www.reddit.com/r/'
    static dataTypes = {
        post: 'new',
        comment: 'comments'
    }

    fetchData = async (type, subredditName, limit = RedditApi.MAX_REDDIT_LIMIT) => {
        const response = await fetch(`${RedditApi.baseUrl}${subredditName}/${RedditApi.dataTypes[type]}.json?sort=new&show=all&limit=${limit}`);
        const body = await response.text();
        return JSON.parse(body).data.children.map(post => post.data);
    }
}

export default RedditApi;