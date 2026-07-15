/* ============ Habitloom guide book — static chapter content ============
   Each guide is pure data; app.js renders it. To add a chapter, add an
   object here with ready: true and a sections array. Section types:
   prose | apps | habits | list | refs. Habits carry a pre-written "why"
   note so planting one from a guide also seeds the check-in reminder. */

(function () {
  const GUIDES = [
    {
      id: "attention",
      icon: "📵",
      title: "Reclaim your attention",
      tagline: "Why your phone is so hard to put down — and the first step back.",
      minutes: 4,
      ready: true,
      sections: [
        {
          type: "prose",
          title: "The cheap-dopamine loop",
          paragraphs: [
            "Your phone isn't hard to put down because you're weak — it's hard because it was built that way. Every scroll is a pull on a slot machine: <em>maybe</em> the next post pays off. Psychologists call this a variable reward, and it's the most habit-forming reinforcement schedule known.",
            "In <em>Dopamine Nation</em>, psychiatrist Anna Lembke describes the brain as a balance between pleasure and pain. Flood it with cheap, effortless dopamine and it compensates by tipping the other way — so the rest of life starts to feel a little flat, and the only thing that sounds appealing is… more phone.",
            "The good news: the balance resets with time away. Lembke's patients usually notice ordinary things feeling good again after a few weeks, and the first week is the hardest. That's exactly what the habits below are for.",
          ],
        },
        {
          type: "apps",
          title: "Get specific: name the app",
          intro: "“Less screen time” fails because it's vague. “One week off Instagram” is a habit you can actually check off. Pick the app that eats most of your attention:",
          apps: [
            {
              id: "instagram",
              name: "Instagram",
              icon: "📸",
              hook: "Runs on social comparison plus variable rewards — you never know which scroll or which like will pay off, so you keep pulling the lever.",
              tactics: [
                "Turn off every Instagram notification. Nothing there is urgent.",
                "Log out after each visit — the login screen is a speed bump that breaks autopilot.",
                "Move the icon off your home screen, or delete the app and keep the (worse) website.",
              ],
              habit: {
                name: "One week off Instagram",
                note: "Cheap dopamine numbs everything else. After a week or two away, ordinary life starts tasting good again (Dopamine Nation). The feed loses nothing while I'm gone — I lose plenty while I'm there.",
              },
            },
            {
              id: "shortform",
              name: "TikTok / Reels / Shorts",
              icon: "🎞️",
              hook: "Short-form video is the tightest dopamine loop ever engineered: full-screen, endless, and tuned to you within minutes. There is no natural stopping point — that's the design.",
              tactics: [
                "Delete the app entirely. Friction works: the browser version is clunky on purpose.",
                "Tell one person you're taking a week off — social stakes beat silent resolutions.",
                "Decide in advance what fills the gap (see “When the boredom hits” below).",
              ],
              habit: {
                name: "Seven days without short-form video",
                note: "Short-form video trains my brain to need a new hit every 8 seconds — and then books, work, and people feel slow. One week to let my attention span grow back.",
              },
            },
            {
              id: "youtube",
              name: "YouTube",
              icon: "▶️",
              hook: "Autoplay and the recommendation feed turn one intentional video into an unplanned evening.",
              tactics: [
                "Turn off autoplay. One tap, permanently.",
                "Never browse the home feed — arrive with a search, watch the thing, leave.",
                "Unsubscribe from every channel you watch out of habit rather than interest.",
              ],
              habit: {
                name: "YouTube only on purpose",
                note: "I open YouTube knowing what I came for, watch it, and close it. The home feed and autoplay are the slot machine — searching with intent is just using a tool.",
              },
            },
            {
              id: "x",
              name: "X / Twitter",
              icon: "🐦",
              hook: "The variable reward here is outrage — the feed learns exactly what winds you up, because agitation keeps you scrolling.",
              tactics: [
                "No feed before noon: protect your morning brain for your own priorities.",
                "Remove it from your phone; if you must keep it, keep it desktop-only.",
                "Mute the words and accounts that reliably spike your pulse.",
              ],
              habit: {
                name: "No X before noon",
                note: "Whatever is trending will still be trending at lunch. Mornings go to my life, not the timeline's.",
              },
            },
            {
              id: "reddit",
              name: "Reddit",
              icon: "👽",
              hook: "Endless niche novelty — there is always one more thread, and the next one might finally be the great one.",
              tactics: [
                "Log out on every device and browse logged-out only, so there's no tailored feed.",
                "Bookmark the two subreddits that actually help you and go there directly.",
                "No Reddit in bed — the “one more thread” loop is strongest when you're tired.",
              ],
              habit: {
                name: "Reddit-free evenings",
                note: "Evenings are when my defenses are lowest and the scroll runs longest. After dinner, Reddit is closed — my evening belongs to me.",
              },
            },
            {
              id: "games",
              name: "Mobile games",
              icon: "🎮",
              hook: "Daily rewards and streaks are engineered FOMO — the game punishes you for having a life, and calls it loyalty.",
              tactics: [
                "Break a streak on purpose once. Notice that nothing of value was lost.",
                "Delete the one game you'd defend hardest. That's the one that owns you.",
                "Keep games that end — puzzles with a solution beat loops without one.",
              ],
              habit: {
                name: "One week off my main game",
                note: "A streak inside a game is the game training me. The streak I'm building here is mine.",
              },
            },
          ],
        },
        {
          type: "habits",
          title: "Four starter habits",
          intro: "Not app-specific — these change your relationship with the device itself. Habitloom lets you plant one new habit per day, so pick the one that stings the most:",
          habits: [
            {
              name: "Phone sleeps outside the bedroom",
              blurb: "The highest-leverage change on this page: get a cheap alarm clock and charge the phone in the kitchen.",
              note: "Research (Ward et al., “Brain Drain”) shows even a silent phone within reach drains attention. If it sleeps in another room, my first and last thoughts of the day are my own.",
            },
            {
              name: "No screens for the first 30 minutes",
              blurb: "Whoever gets your first half hour sets your baseline for the day.",
              note: "If the day starts with the feed, my brain spends the day chasing that pace. Light, water, movement first — the phone can wait 30 minutes.",
            },
            {
              name: "Keep my phone in grayscale",
              blurb: "Color is the casino lighting. Grayscale makes the slot machine boring (it's in your accessibility settings).",
              note: "Same phone, same apps — but without the color reward the pull drops surprisingly hard. Boring is the point.",
            },
            {
              name: "Notifications from humans only",
              blurb: "Turn off every notification that isn't a person who knows you.",
              note: "Apps interrupt me on their schedule to serve their goals. People can reach me; software can wait until I choose to open it.",
            },
          ],
        },
        {
          type: "list",
          title: "When the boredom hits",
          intro: "Quitting an app leaves a hole, and the craving to fill it feels permanent — but it behaves like a wave: it peaks and passes in ten to twenty minutes (“urge surfing”). Decide now what you'll do when it comes:",
          items: [
            "Step outside for a five-minute walk — movement plus daylight is the fastest legal mood lift.",
            "Read one page of a paper book. Just one; it usually turns into more.",
            "Text or call an actual friend instead of watching strangers.",
            "Stretch, or do ten slow push-ups — give the restlessness somewhere to go.",
            "Tidy one surface. Small, visible, done.",
            "Or do nothing for two minutes. Boredom is the withdrawal symptom — sitting through it is the repair.",
            "Whatever you pick, track it on the Track tab. Watching real hours go to real things is its own reward.",
          ],
        },
        {
          type: "refs",
          title: "Where this comes from",
          refs: [
            { title: "Dopamine Nation", author: "Anna Lembke, 2021", note: "the pleasure–pain balance, and why time away resets it" },
            { title: "Hooked", author: "Nir Eyal, 2014", note: "how apps engineer variable rewards on purpose" },
            { title: "Atomic Habits", author: "James Clear, 2018", note: "make bad cues invisible — design the environment, not the willpower" },
            { title: "Digital Minimalism", author: "Cal Newport, 2019", note: "the 30-day digital declutter" },
            { title: "“Brain Drain” — Ward, Duke, Gneezy & Bos, 2017", author: "Journal of the Association for Consumer Research", note: "the mere presence of your smartphone reduces available working memory" },
          ],
        },
      ],
    },
    {
      id: "sleep",
      icon: "😴",
      title: "Sleep like it matters",
      tagline: "Consistent, deep sleep is the base layer under every other habit.",
      ready: false,
    },
    {
      id: "food",
      icon: "🥗",
      title: "Eat for steady energy",
      tagline: "Fewer spikes and crashes, without turning meals into math.",
      ready: false,
    },
    {
      id: "move",
      icon: "🏃",
      title: "Move a little, daily",
      tagline: "The minimum effective dose of exercise for mood and focus.",
      ready: false,
    },
  ];

  window.__GUIDES = GUIDES;
  if (typeof module !== "undefined" && module.exports) module.exports = { GUIDES };
})();
