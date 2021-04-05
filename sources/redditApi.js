import fetch from 'node-fetch';

class RedditApi {
    static MAX_REQUEST_RECORDS_LIMIT = 100
    static MAX_REQUEST_PER_MINUTE = 60
    static baseUrl = 'https://www.reddit.com/r/'
    static dataTypes = {
        post: 'new',
        comment: 'comments'
    }

    fetchData = async (type, subredditName, limit = RedditApi.MAX_REQUEST_RECORDS_LIMIT) => {
        const response = await fetch(`${RedditApi.baseUrl}${subredditName}/${RedditApi.dataTypes[type]}.json?sort=new&show=all&limit=${limit}`);
        const body = await response.text();
        return JSON.parse(body).data.children.map(post => post.data);
    }
}

export default RedditApi;