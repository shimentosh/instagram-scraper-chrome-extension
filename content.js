const IG_APP_ID = '936619743392459';
let stopRequested = false;

function getCsrf() {
  const m = document.cookie.match(/csrftoken=([^;]+)/);
  return m ? m[1] : '';
}

function getWwwClaim() {
  const m = document.cookie.match(/ig_www_claim=([^;]+)/);
  return m ? m[1] : '0';
}

async function igFetch(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      'X-CSRFToken': getCsrf(),
      'X-IG-App-ID': IG_APP_ID,
      'X-ASBD-ID': '198387',
      'X-IG-WWW-Claim': getWwwClaim(),
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': '*/*',
      ...options.headers,
    },
    ...options,
  });
  if (resp.status === 429) throw new Error('Rate limited by Instagram. Please wait a few minutes and try again.');
  if (resp.status === 401) throw new Error('Not authenticated. Please make sure you are logged in to Instagram.');
  if (resp.status === 403) throw new Error('Access denied. This account may be private or require follow approval.');
  if (!resp.ok) throw new Error(`Instagram API error: HTTP ${resp.status}`);
  return resp.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sendProgress(count, total, label) {
  chrome.runtime.sendMessage({ type: 'scrapeProgress', count, total, label }).catch(() => {});
}

function shortcodeToId(shortcode) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = BigInt(0);
  for (const c of shortcode) {
    const idx = alpha.indexOf(c);
    if (idx !== -1) id = id * BigInt(64) + BigInt(idx);
  }
  return id.toString();
}

function extractShortcode(url) {
  const m = (url || '').match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseUser(u) {
  return {
    username: u.username || '',
    full_name: u.full_name || '',
    user_id: String(u.pk || u.id || ''),
    is_verified: u.is_verified ? 'Yes' : 'No',
    is_private: u.is_private ? 'Yes' : 'No',
    followers: u.follower_count || '',
    following: u.following_count || '',
    profile_url: `https://www.instagram.com/${u.username}/`,
    profile_pic_url: u.profile_pic_url || '',
  };
}

function parsePost(item) {
  if (!item) return {};
  const caption = item.caption?.text || '';
  const hashtags = [...caption.matchAll(/#(\w+)/g)].map(m => m[1]);
  const mentions = [...caption.matchAll(/@(\w+)/g)].map(m => m[1]);
  const images = item.image_versions2?.candidates || [];
  const isVideo = item.media_type === 2;
  const isCarousel = item.media_type === 8;
  return {
    post_id: item.id || '',
    shortcode: item.code || '',
    url: item.code ? `https://www.instagram.com/p/${item.code}/` : '',
    type: isCarousel ? 'carousel' : isVideo ? 'video' : 'image',
    caption: caption.replace(/\n/g, ' '),
    hashtags: hashtags.join(' '),
    mentions: mentions.join(' '),
    likes: item.like_count || 0,
    comments: item.comment_count || 0,
    views: item.view_count || item.play_count || '',
    timestamp: item.taken_at ? new Date(item.taken_at * 1000).toISOString() : '',
    image_url: images[0]?.url || '',
    is_sponsored: item.is_paid_partnership ? 'Yes' : 'No',
    location: item.location?.name || '',
    owner: item.user?.username || '',
  };
}

function parseComment(c) {
  return {
    comment_id: c.pk || '',
    text: (c.text || '').replace(/\n/g, ' '),
    username: c.user?.username || '',
    full_name: c.user?.full_name || '',
    timestamp: c.created_at ? new Date(c.created_at * 1000).toISOString() : '',
    likes: c.comment_like_count || 0,
    replies: c.child_comment_count || 0,
  };
}

async function scrapeProfile(username) {
  const data = await igFetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  );
  const u = data.data?.user;
  if (!u) throw new Error('User not found or account is private.');
  return [{
    username: u.username,
    full_name: u.full_name,
    user_id: u.id,
    bio: (u.biography || '').replace(/\n/g, ' '),
    followers: u.edge_followed_by?.count ?? '',
    following: u.edge_follow?.count ?? '',
    posts: u.edge_owner_to_timeline_media?.count ?? '',
    is_verified: u.is_verified ? 'Yes' : 'No',
    is_private: u.is_private ? 'Yes' : 'No',
    is_business: u.is_business_account ? 'Yes' : 'No',
    category: u.category_name || '',
    website: u.external_url || '',
    profile_pic_url: u.profile_pic_url_hd || u.profile_pic_url || '',
    joined_recently: u.is_joined_recently ? 'Yes' : 'No',
    profile_url: `https://www.instagram.com/${u.username}/`,
  }];
}

async function getUserId(username) {
  const data = await igFetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
  );
  const id = data.data?.user?.id;
  if (!id) throw new Error(`User @${username} not found.`);
  return id;
}

async function scrapePosts(username, maxCount) {
  const userId = await getUserId(username);
  const posts = [];
  let maxId = null;
  sendProgress(0, maxCount);
  while (posts.length < maxCount && !stopRequested) {
    const url = `https://www.instagram.com/api/v1/feed/user/${userId}/?count=12${maxId ? `&max_id=${maxId}` : ''}`;
    const data = await igFetch(url);
    for (const item of (data.items || [])) {
      posts.push(parsePost(item));
      if (posts.length >= maxCount) break;
    }
    sendProgress(posts.length, maxCount);
    if (!data.more_available || !data.items?.length) break;
    maxId = data.next_max_id;
    await sleep(800);
  }
  return posts;
}

async function scrapeFollowers(username, maxCount) {
  const userId = await getUserId(username);
  const users = [];
  let maxId = null;
  sendProgress(0, maxCount);
  while (users.length < maxCount && !stopRequested) {
    const url = `https://www.instagram.com/api/v1/friendships/${userId}/followers/?count=200${maxId ? `&max_id=${maxId}` : ''}`;
    const data = await igFetch(url);
    for (const u of (data.users || [])) {
      users.push(parseUser(u));
      if (users.length >= maxCount) break;
    }
    sendProgress(users.length, maxCount);
    if (!data.next_max_id || !data.users?.length) break;
    maxId = data.next_max_id;
    await sleep(1200);
  }
  return users;
}

async function scrapeFollowing(username, maxCount) {
  const userId = await getUserId(username);
  const users = [];
  let maxId = null;
  sendProgress(0, maxCount);
  while (users.length < maxCount && !stopRequested) {
    const url = `https://www.instagram.com/api/v1/friendships/${userId}/following/?count=200${maxId ? `&max_id=${maxId}` : ''}`;
    const data = await igFetch(url);
    for (const u of (data.users || [])) {
      users.push(parseUser(u));
      if (users.length >= maxCount) break;
    }
    sendProgress(users.length, maxCount);
    if (!data.next_max_id || !data.users?.length) break;
    maxId = data.next_max_id;
    await sleep(1200);
  }
  return users;
}

async function scrapeComments(postUrl, maxCount, sortOrder = 'popular') {
  const sc = extractShortcode(postUrl);
  if (!sc) throw new Error('Invalid post URL. Use a URL like https://www.instagram.com/p/ABC123/');
  const mediaId = shortcodeToId(sc);
  const comments = [];
  let minId = null;
  sendProgress(0, maxCount);
  while (comments.length < maxCount && !stopRequested) {
    const url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&sort_order=${sortOrder}${minId ? `&min_id=${minId}` : ''}`;
    const data = await igFetch(url);
    for (const c of (data.comments || [])) {
      comments.push(parseComment(c));
      if (comments.length >= maxCount) break;
    }
    sendProgress(comments.length, maxCount);
    if (!data.next_min_id || !data.comments?.length) break;
    minId = data.next_min_id;
    await sleep(800);
  }
  return comments;
}

async function scrapeLikers(postUrl) {
  const sc = extractShortcode(postUrl);
  if (!sc) throw new Error('Invalid post URL. Use a URL like https://www.instagram.com/p/ABC123/');
  const mediaId = shortcodeToId(sc);
  const data = await igFetch(`https://www.instagram.com/api/v1/media/${mediaId}/likers/`);
  const users = (data.users || []).map(parseUser);
  sendProgress(users.length, users.length);
  return users;
}

async function scrapeHashtag(hashtag, maxCount) {
  const tag = hashtag.replace(/^#/, '');

  // Phase 1 — collect post shortcodes by scrolling the explore page
  const shortcodes = [];
  const seen = new Set();
  let stuckRounds = 0;
  sendProgress(0, maxCount, 'Collecting posts');

  while (shortcodes.length < maxCount && !stopRequested && stuckRounds < 5) {
    const prev = shortcodes.length;

    document.querySelectorAll('a[href*="/p/"]').forEach(a => {
      const m = a.href.match(/\/p\/([A-Za-z0-9_-]+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      shortcodes.push(m[1]);
    });

    sendProgress(shortcodes.length, maxCount, 'Collecting posts');
    if (shortcodes.length >= maxCount) break;

    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    await sleep(2200);

    if (shortcodes.length === prev) stuckRounds++;
    else stuckRounds = 0;
  }

  // Phase 2 — fetch full engagement data for each collected post
  const toFetch = shortcodes.slice(0, maxCount);
  const posts = [];

  for (let i = 0; i < toFetch.length && !stopRequested; i++) {
    const sc = toFetch[i];
    const mediaId = shortcodeToId(sc);
    try {
      const data = await igFetch(`https://www.instagram.com/api/v1/media/${mediaId}/info/`);
      const item = data.items?.[0];
      if (item) {
        posts.push(parsePost(item));
      } else {
        posts.push({ shortcode: sc, url: `https://www.instagram.com/p/${sc}/` });
      }
    } catch (_) {
      posts.push({ shortcode: sc, url: `https://www.instagram.com/p/${sc}/` });
    }
    sendProgress(i + 1, toFetch.length, 'Fetching engagement');
    await sleep(600);
  }

  return { info: { hashtag: tag, total_collected: posts.length }, posts };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  if (msg.type === 'ping') {
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'stopScrape') {
    stopRequested = true;
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'startScrape') {
    stopRequested = false;
    sendResponse({ ok: true, status: 'started' });

    const { action, params } = msg;
    let promise;
    switch (action) {
      case 'profile':   promise = scrapeProfile(params.username); break;
      case 'posts':     promise = scrapePosts(params.username, params.maxCount || 50); break;
      case 'followers': promise = scrapeFollowers(params.username, params.maxCount || 200); break;
      case 'following': promise = scrapeFollowing(params.username, params.maxCount || 200); break;
      case 'comments':  promise = scrapeComments(params.postUrl, params.maxCount || 100, params.sortOrder || 'popular'); break;
      case 'likers':    promise = scrapeLikers(params.postUrl); break;
      case 'hashtag':   promise = scrapeHashtag(params.hashtag, params.maxCount || 50); break;
      default:
        chrome.runtime.sendMessage({ type: 'scrapeError', error: 'Unknown action' }).catch(() => {});
        return;
    }

    promise
      .then(data => {
        chrome.storage.local.set({ igScrapeResult: JSON.stringify(data), igScrapeAction: action });
        chrome.runtime.sendMessage({ type: 'scrapeComplete', action }).catch(() => {});
      })
      .catch(e => {
        chrome.runtime.sendMessage({ type: 'scrapeError', error: e.message }).catch(() => {});
      });

    return true;
  }
});

function log(text) {
  try { chrome.runtime.sendMessage({ type: 'log', text: String(text), source: 'content' }); } catch (_) {}
}
log('Instagram Scraper loaded');
