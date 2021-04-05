import RedditStreamer from './redditStreamer.js'
import RedditStreamerTunner from './redditStreamerTuner.js';

class RedditSource {
    constructor(subreddits) {
        this.subreddits = subreddits
        this.streamer = new RedditStreamer(subreddits);
    }

    start = () => {
        const { streamer } = this
        const tuner = new RedditStreamerTunner(this.subreddits);
        streamer.suscribe('tuner', ['stream'], tuner.handleDataStream)
        // streamer.suscribers('ingester', 'all', ingester.handleDataStream())

        streamer.init(tuner)
    }
}

const suscribedSubreddits = ['wallstreetbets', 'investing', 'stocks', 'askreddit']
new RedditSource(suscribedSubreddits).start()