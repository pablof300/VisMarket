class RedditIngester {
    handleDataStream = (data) => {

    }

    createPostTable = () => {
        const query = `
            CREATE TABLE posts (
                id VARCHAR(50) PRIMARY KEY,
                postName VARCHAR(255),
                ups INTEGER,
                downs INTEGER,
                created BIGINT,
                subreddit VARCHAR(50),
                authorFullname VARCHAR(50),
                title VARCHAR(50),
                upvoteRatio REAL,
                totalAwardsReceived INTEGER,
                mediaEmbed JSONB,
                
            );
        `;
    }
}

export default RedditIngester