import RedditIngester from './redditIngester.js';
import RedditStreamer from './redditStreamer.js'
import RedditStreamerTunner from './redditStreamerTuner.js';

class RedditSource {
    constructor(subreddits) {
        this.subreddits = subreddits
        this.streamer = new RedditStreamer(subreddits);
        this.ingester = new RedditIngester();
    }

    start = () => {
        const { streamer, ingester } = this
        const tuner = new RedditStreamerTunner(this.subreddits);
        streamer.suscribe('tuner', ['stream'], tuner.handleDataStream)
        streamer.suscribe('ingester', 'all', ingester.handleDataStream)

        streamer.init(tuner)
    }
}

const suscribedSubreddits = ['wallstreetbets', 'investing', 'stocks', 'SecurityAnalysis', 'cryptocurrency', ]
new RedditSource(suscribedSubreddits).start()