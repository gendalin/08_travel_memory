# Recommendation trace — R2

Run: 20260930_2033_src-9deb1bc

## Input signals
```json
{
  "intent": [
    "Showa-era literary and cultural atmosphere",
    "slow neighborhood exploration",
    "old bookstores",
    "kissaten",
    "small independent cultural places",
    "as many bookstores as possible"
  ],
  "considering": [],
  "stateTerms": [
    "showa",
    "literary",
    "cultural",
    "atmosphere",
    "slow",
    "neighborhood",
    "exploration",
    "bookstores",
    "kissaten",
    "small",
    "independent",
    "places",
    "many",
    "possible"
  ],
  "memories": [
    {
      "id": "mem_eval_r2_bookstores",
      "kind": "preference",
      "subject": {
        "facet": "category",
        "value": "bookstore"
      },
      "strength": 1
    }
  ],
  "categoryPreferences": [
    {
      "category": "bookstore",
      "memoryId": "mem_eval_r2_bookstores",
      "weight": 1
    }
  ],
  "priorityWeights": {
    "convenience": 1,
    "cost": 1,
    "novelty": 1
  },
  "pace": 5,
  "roles": [
    "main_destination",
    "lunch",
    "extension_2",
    "dinner",
    "nightcap"
  ]
}
```
## Semantic expansion
```json
{
  "searches": [
    {
      "category": "bookstore",
      "textQuery": "bookstore near Kuramae, Tokyo",
      "retrieve": 15
    },
    {
      "category": "bar_cocktail",
      "textQuery": "bar cocktail near Kuramae, Tokyo",
      "retrieve": 6
    },
    {
      "category": "izakaya",
      "textQuery": "izakaya near Kuramae, Tokyo",
      "retrieve": 6
    },
    {
      "category": "yakiniku_grill",
      "textQuery": "yakiniku grill near Kuramae, Tokyo",
      "retrieve": 6
    },
    {
      "category": "architecture_design",
      "textQuery": "architecture design near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "bakery_sweets",
      "textQuery": "bakery sweets near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "cafe_kissaten",
      "textQuery": "cafe kissaten near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "exhibition_event",
      "textQuery": "exhibition event near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "fashion_vintage",
      "textQuery": "fashion vintage near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "lifestyle_homeware",
      "textQuery": "lifestyle homeware near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "museum_gallery",
      "textQuery": "museum gallery near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "park_garden",
      "textQuery": "park garden near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "ramen",
      "textQuery": "ramen near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "soba_udon",
      "textQuery": "soba udon near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "sushi",
      "textQuery": "sushi near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "teishoku",
      "textQuery": "teishoku near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "temple_shrine",
      "textQuery": "temple shrine near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "tempura_tonkatsu",
      "textQuery": "tempura tonkatsu near Kuramae, Tokyo",
      "retrieve": 3
    },
    {
      "category": "viewpoint_scenic",
      "textQuery": "viewpoint scenic near Kuramae, Tokyo",
      "retrieve": 3
    }
  ],
  "stateTermsReachingAnyQuery": [
    "kissaten"
  ],
  "stateTermsLost": [
    "showa",
    "literary",
    "cultural",
    "atmosphere",
    "slow",
    "neighborhood",
    "exploration",
    "bookstores",
    "small",
    "independent",
    "places",
    "many",
    "possible"
  ],
  "radiusMetres": null
}
```
## Area candidates
```json
{
  "stageExists": false,
  "note": "No area-level retrieval: searches are \"<lodging> <category>\" around the base lodging. Neighbourhoods below are what the pool happens to contain.",
  "neighborhoodsInPool": {
    "Kuramae": 37,
    "Kamezawa": 1,
    "Torigoe": 1,
    "Asakusa": 12,
    "Kitanomarukōen": 1,
    "Kanda Jinbōchō": 1,
    "Yokoami": 2,
    "Honjo": 3,
    "Yanagibashi": 4,
    "Sotokanda": 1,
    "Kotobuki": 5,
    "Marunouchi": 2,
    "Asakusabashi": 4,
    "Higashishinagawa": 1,
    "Roppongi": 1,
    "Misuji": 5,
    "Nishiasakusa": 2,
    "Azumabashi": 1,
    "Toyosu": 1,
    "Komagata": 1,
    "Kaminarimon": 3,
    "Midori": 1,
    "Ueno": 1,
    "Motoasakusa": 1,
    "Hanakawado": 2,
    "Kuramahonmachi": 1,
    "Uenokōen": 1,
    "Miyoshi": 1,
    "Oshiage": 1,
    "Akasaka": 1,
    "Ginza": 1,
    "Toranomon": 2,
    "Jingūmae": 1,
    "Nihonbashikodenmachō": 1
  }
}
```
## POI candidates / hard filters
```json
{
  "poi": {
    "poolSize": 104,
    "byCategory": {
      "cafe_kissaten": 9,
      "izakaya": 11,
      "museum_gallery": 17,
      "park_garden": 5,
      "ramen": 6,
      "soba_udon": 2,
      "bar_cocktail": 11,
      "yakiniku_grill": 5,
      "temple_shrine": 5,
      "tempura_tonkatsu": 2,
      "viewpoint_scenic": 1,
      "grocery_market": 8,
      "fashion_vintage": 3,
      "bookstore": 5,
      "bakery_sweets": 2,
      "lifestyle_homeware": 3,
      "onsen_sento": 3,
      "sushi": 6
    }
  },
  "filters": [
    {
      "role": "main_destination",
      "categoryGate": "28/104 pass",
      "closedAtRoleStart": 16,
      "closedSample": [
        "The National Museum of Modern Art, Tokyo",
        "Quiet Gallery",
        "Seika Park"
      ]
    },
    {
      "role": "lunch",
      "categoryGate": "25/104 pass",
      "closedAtRoleStart": 5,
      "closedSample": [
        "KURAMAE CANNELE",
        "Coffee Wrights Kuramae",
        "Sushi Komurasaki"
      ]
    },
    {
      "role": "extension_2",
      "categoryGate": "72/104 pass",
      "closedAtRoleStart": 29,
      "closedSample": [
        "KURAMAE CANNELE",
        "The National Museum of Modern Art, Tokyo",
        "Quiet Gallery"
      ]
    },
    {
      "role": "dinner",
      "categoryGate": "32/104 pass",
      "closedAtRoleStart": 6,
      "closedSample": [
        "Ichi ryu",
        "Matsuya Asakusabashi",
        "Yakiniku BEAST Kuramae"
      ]
    },
    {
      "role": "nightcap",
      "categoryGate": "27/104 pass",
      "closedAtRoleStart": 7,
      "closedSample": [
        "Matsuya Asakusabashi",
        "Yakiniku BEAST Kuramae",
        "Masu Kuramae"
      ]
    }
  ]
}
```
## Top 10 (neutral context: Day 1, from lodging)

| # | Place | Category | Total | stateMatch | memoryMatch | novelty | convenience | cost |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Okuramae Shobō | bookstore | 0.729 | 0.7 | 1 | 0 | 0.939 | null |
| 2 | Tōmei Bookstore | bookstore | 0.704 | 0.7 | 1 | 0 | 0.834 | null |
| 3 | Kamifuku Books | bookstore | 0.679 | 0.7 | 1 | 0 | 0.736 | null |
| 4 | Infinity Books Japan | bookstore | 0.663 | 0.7 | 1 | 0 | 0.677 | null |
| 5 | Kumazawa Book Store | bookstore | 0.649 | 0.7 | 1 | 0 | 0.623 | null |
| 6 | snaq.me stand Kuramae | cafe_kissaten | 0.613 | 0.7 | 0 | 0.582 | 0.977 | 0.75 |
| 7 | Kuramae Park | park_garden | 0.576 | 0.7 | 0 | 0.516 | 0.954 | null |
| 8 | Coffee Wrights Kuramae | cafe_kissaten | 0.573 | 0.7 | 0 | 0.355 | 0.933 | 0.75 |
| 9 | SUNDAE APART | cafe_kissaten | 0.573 | 0.7 | 0 | 0.582 | 0.946 | 0.5 |
| 10 | KURAMAE CANNELE | cafe_kissaten | 0.572 | 0.7 | 0 | 0.336 | 0.942 | 0.75 |

## Diversity
```json
{
  "categoryCounts": {
    "park_garden": 2,
    "cafe_kissaten": 5,
    "bookstore": 4,
    "yakiniku_grill": 1,
    "bar_cocktail": 4,
    "temple_shrine": 1,
    "izakaya": 3,
    "museum_gallery": 2,
    "sushi": 1,
    "ramen": 1,
    "grocery_market": 1
  },
  "neighborhoodCounts": {
    "Kuramae": 14,
    "Asakusa": 3,
    "Hanakawado": 1,
    "Honjo": 1,
    "Azumabashi": 1,
    "Yokoami": 1,
    "Kamezawa": 1,
    "Asakusabashi": 1,
    "Yanagibashi": 1,
    "Oshiage": 1
  },
  "interventions": [
    {
      "itemId": "item_d0_nightcap",
      "winner": "ChIJmx42NBuPGGARy2nxJRtD90Q",
      "withoutRule": "ChIJsw0inamPGGARML0W6O84DPY"
    },
    {
      "itemId": "item_d1_extension_2",
      "winner": "ChIJA6ObqMaOGGARNzoD87obfJI",
      "withoutRule": "ChIJxyK9lrGOGGARg15egohj6PI"
    },
    {
      "itemId": "item_d1_dinner",
      "winner": "ChIJD4ces_WPGGARmvEnfnK45aM",
      "withoutRule": "ChIJwZZ9SoqPGGARALAMRDDGKK8"
    },
    {
      "itemId": "item_d1_nightcap",
      "winner": "ChIJS5IgRcGOGGARyW5CDXx99uE",
      "withoutRule": "ChIJGW7xTZaPGGAR8a7GG5Bayx0"
    },
    {
      "itemId": "item_d2_lunch",
      "winner": "ChIJP3bEKAiPGGAReLTK-b4prpE",
      "withoutRule": "ChIJxUP_Y-iJGGAR1Mm00ouCVUM"
    },
    {
      "itemId": "item_d2_nightcap",
      "winner": "ChIJXQN4ucaOGGARhxf9DhcXAZ0",
      "withoutRule": "ChIJpaEV8U-NGGAR4M9euLVRX3c"
    },
    {
      "itemId": "item_d4_extension_2",
      "winner": "ChIJbYldo2WPGGARUphfxmlPtSw",
      "withoutRule": "ChIJjbNYOACPGGARHjKCX5UPco4"
    },
    {
      "itemId": "item_d4_dinner",
      "winner": "ChIJmwPWxbeOGGARR85ktv868QU",
      "withoutRule": "ChIJxX8jY5aPGGARDCvoWOA1AEE"
    },
    {
      "itemId": "item_d4_nightcap",
      "winner": "ChIJGW7xTZaPGGAR8a7GG5Bayx0",
      "withoutRule": "ChIJpaEV8U-NGGAR4M9euLVRX3c"
    }
  ]
}
```
## Route / time
```json
{
  "days": [
    {
      "dayIndex": 0,
      "stops": 5,
      "spanKm": 0.41,
      "maxHopKm": 0.41,
      "pathKm": 1.32,
      "categories": [
        "park_garden",
        "cafe_kissaten",
        "bookstore",
        "yakiniku_grill",
        "bar_cocktail"
      ],
      "neighborhoods": [
        "Kuramae",
        "Kuramae",
        "Kuramae",
        "Kuramae",
        "Kuramae"
      ]
    },
    {
      "dayIndex": 1,
      "stops": 5,
      "spanKm": 1.54,
      "maxHopKm": 1.54,
      "pathKm": 8.27,
      "categories": [
        "temple_shrine",
        "cafe_kissaten",
        "bookstore",
        "izakaya",
        "izakaya"
      ],
      "neighborhoods": [
        "Asakusa",
        "Kuramae",
        "Hanakawado",
        "Kuramae",
        "Asakusa"
      ]
    },
    {
      "dayIndex": 2,
      "stops": 5,
      "spanKm": 1.22,
      "maxHopKm": 1.1,
      "pathKm": 5.45,
      "categories": [
        "museum_gallery",
        "cafe_kissaten",
        "bookstore",
        "sushi",
        "bar_cocktail"
      ],
      "neighborhoods": [
        "Honjo",
        "Kuramae",
        "Azumabashi",
        "Kuramae",
        "Asakusa"
      ]
    },
    {
      "dayIndex": 3,
      "stops": 5,
      "spanKm": 1.15,
      "maxHopKm": 1.15,
      "pathKm": 3.28,
      "categories": [
        "park_garden",
        "cafe_kissaten",
        "bookstore",
        "ramen",
        "bar_cocktail"
      ],
      "neighborhoods": [
        "Yokoami",
        "Kamezawa",
        "Asakusabashi",
        "Yanagibashi",
        "Kuramae"
      ]
    },
    {
      "dayIndex": 4,
      "stops": 5,
      "spanKm": 2.01,
      "maxHopKm": 2.01,
      "pathKm": 4.68,
      "categories": [
        "museum_gallery",
        "cafe_kissaten",
        "grocery_market",
        "izakaya",
        "bar_cocktail"
      ],
      "neighborhoods": [
        "Oshiage",
        "Kuramae",
        "Kuramae",
        "Kuramae",
        "Kuramae"
      ]
    }
  ],
  "validation": {
    "valid": true,
    "errors": []
  },
  "unfilled": [],
  "tensions": []
}
```
## Final POIs
```json
[
  {
    "itemId": "item_d0_main_destination",
    "day": 1,
    "role": "main_destination",
    "time": "10:00-11:00",
    "placeId": "ChIJWQSdSLaOGGARk7qGNVyECxI",
    "name": "Kuramae Park",
    "category": "park_garden",
    "placedBy": "ranking",
    "reasons": [
      "For “small independent cultural places”: its description mentions “small”.",
      "A 1-minute walk from Kuramae.",
      "Chosen over The Yogodo Hall, which is farther from Kuramae."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJq6o6tMGOGGARKQz3RsHmBZw",
      "name": "The Yogodo Hall",
      "score": 0.466,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d0_lunch",
    "day": 1,
    "role": "lunch",
    "time": "12:45-13:30",
    "placeId": "ChIJjZFyLquPGGARgPO6dprcE9M",
    "name": "snaq.me stand Kuramae",
    "category": "cafe_kissaten",
    "placedBy": "ranking",
    "reasons": [
      "For “kissaten”: it is a cafe or kissaten.",
      "A 2-minute walk from Kuramae Park.",
      "Chosen over SUNDAE APART, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJjbNYOACPGGARHjKCX5UPco4",
      "name": "SUNDAE APART",
      "score": 0.569,
      "lostOn": "cost"
    }
  },
  {
    "itemId": "item_d0_extension_2",
    "day": 1,
    "role": "extension_2",
    "time": "14:00-15:00",
    "placeId": "ChIJkX42vLeOGGARszgelkFQv9g",
    "name": "Okuramae Shobō",
    "category": "bookstore",
    "placedBy": "memory?",
    "reasons": [
      "Bookstore turns up 1 times in your photos and saved places.",
      "For “old bookstores”: its description mentions “bookstore”.",
      "Chosen over Infinity Books Japan, which is farther from Kuramae Park."
    ],
    "memoryRefs": [
      "mem_eval_r2_bookstores"
    ],
    "runnerUp": {
      "placeId": "ChIJnakmQs-OGGARv8OIIEav9rM",
      "name": "Infinity Books Japan",
      "score": 0.664,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d0_dinner",
    "day": 1,
    "role": "dinner",
    "time": "18:00-19:45",
    "placeId": "ChIJ1VoOUlaPGGART1vGZT_NUJg",
    "name": "鶏焼肉専門店 とり鮮",
    "category": "yakiniku_grill",
    "placedBy": "ranking",
    "reasons": [
      "A 3-minute walk from snaq.me stand Kuramae.",
      "Keeps Day 1 close together.",
      "Chosen over Yello, which is better known."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJD4ces_WPGGARmvEnfnK45aM",
      "name": "Yello",
      "score": 0.466,
      "lostOn": "novelty"
    }
  },
  {
    "itemId": "item_d0_nightcap",
    "day": 1,
    "role": "nightcap",
    "time": "21:00-22:15",
    "placeId": "ChIJmx42NBuPGGARy2nxJRtD90Q",
    "name": "Bar Boushu 蔵前 & Hotel Villa Kuramae（バー ボウシュ & ホテル ヴィラ クラマエ) Whisky & Wine & Cocktail",
    "category": "bar_cocktail",
    "placedBy": "ranking",
    "reasons": [
      "A 1-minute walk from Okuramae Shobō.",
      "Keeps Day 1 close together.",
      "Chosen over PHERMENT BREWING, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJpaEV8U-NGGAR4M9euLVRX3c",
      "name": "PHERMENT BREWING",
      "score": 0.474,
      "lostOn": "cost"
    }
  },
  {
    "itemId": "item_d1_main_destination",
    "day": 2,
    "role": "main_destination",
    "time": "10:00-11:00",
    "placeId": "ChIJq6o6tMGOGGARKQz3RsHmBZw",
    "name": "The Yogodo Hall",
    "category": "temple_shrine",
    "placedBy": "ranking",
    "reasons": [
      "For “small independent cultural places”: it is a place of worship.",
      "A 18-minute walk from Kuramae.",
      "Chosen over Tokyo Origami Museum, which is a weaker match for what you wrote."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJA9TmNMmOGGARG_c-vBf8kDA",
      "name": "Tokyo Origami Museum",
      "score": 0.411,
      "lostOn": "stateMatch"
    }
  },
  {
    "itemId": "item_d1_lunch",
    "day": 2,
    "role": "lunch",
    "time": "12:45-13:30",
    "placeId": "ChIJbdCh6LaOGGAR66AikEbVY7g",
    "name": "Square Cafe",
    "category": "cafe_kissaten",
    "placedBy": "ranking",
    "reasons": [
      "For “kissaten”: it is a cafe or kissaten.",
      "Keeps Day 2 close together.",
      "Chosen over KURAMAE CANNELE, which is better known."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJP3bEKAiPGGAReLTK-b4prpE",
      "name": "KURAMAE CANNELE",
      "score": 0.502,
      "lostOn": "novelty"
    }
  },
  {
    "itemId": "item_d1_extension_2",
    "day": 2,
    "role": "extension_2",
    "time": "14:00-15:00",
    "placeId": "ChIJA6ObqMaOGGARNzoD87obfJI",
    "name": "Kumazawa Book Store",
    "category": "bookstore",
    "placedBy": "memory?",
    "reasons": [
      "Bookstore turns up 1 times in your photos and saved places.",
      "For “old bookstores”: it is a bookstore.",
      "Chosen over Infinity Books Japan, which is farther from The Yogodo Hall."
    ],
    "memoryRefs": [
      "mem_eval_r2_bookstores"
    ],
    "runnerUp": {
      "placeId": "ChIJnakmQs-OGGARv8OIIEav9rM",
      "name": "Infinity Books Japan",
      "score": 0.671,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d1_dinner",
    "day": 2,
    "role": "dinner",
    "time": "18:00-19:45",
    "placeId": "ChIJD4ces_WPGGARmvEnfnK45aM",
    "name": "Yello",
    "category": "izakaya",
    "placedBy": "ranking",
    "reasons": [
      "A 1-minute walk from Square Cafe.",
      "Keeps Day 2 close together.",
      "Chosen over Minatsuki, which is farther from Square Cafe."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJxX8jY5aPGGARDCvoWOA1AEE",
      "name": "Minatsuki",
      "score": 0.453,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d1_nightcap",
    "day": 2,
    "role": "nightcap",
    "time": "21:00-22:30",
    "placeId": "ChIJS5IgRcGOGGARyW5CDXx99uE",
    "name": "Ougiya",
    "category": "izakaya",
    "placedBy": "ranking",
    "reasons": [
      "A 2-minute walk from Kumazawa Book Store.",
      "Keeps Day 2 close together.",
      "Chosen over Soba Udon Monju Asakusa Branch, which is better known."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJXQN4ucaOGGARhxf9DhcXAZ0",
      "name": "Soba Udon Monju Asakusa Branch",
      "score": 0.469,
      "lostOn": "novelty"
    }
  },
  {
    "itemId": "item_d2_main_destination",
    "day": 3,
    "role": "main_destination",
    "time": "10:00-11:30",
    "placeId": "ChIJA9TmNMmOGGARG_c-vBf8kDA",
    "name": "Tokyo Origami Museum",
    "category": "museum_gallery",
    "placedBy": "ranking",
    "reasons": [
      "A 9-minute walk from Kuramae.",
      "Chosen over Former Yasuda Garden, which is better known."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJZeLCusqOGGARuV76qbNiFkY",
      "name": "Former Yasuda Garden",
      "score": 0.379,
      "lostOn": "novelty"
    }
  },
  {
    "itemId": "item_d2_lunch",
    "day": 3,
    "role": "lunch",
    "time": "12:45-13:30",
    "placeId": "ChIJP3bEKAiPGGAReLTK-b4prpE",
    "name": "KURAMAE CANNELE",
    "category": "cafe_kissaten",
    "placedBy": "ranking",
    "reasons": [
      "For “kissaten”: it is a cafe or kissaten.",
      "A 10-minute walk from Tokyo Origami Museum.",
      "Chosen over Coffee Wrights Kuramae, which is further from the rest of the day."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJT52xaLeOGGAR6ZstEJFAmF0",
      "name": "Coffee Wrights Kuramae",
      "score": 0.532,
      "lostOn": "routeFit"
    }
  },
  {
    "itemId": "item_d2_extension_2",
    "day": 3,
    "role": "extension_2",
    "time": "14:00-15:00",
    "placeId": "ChIJnakmQs-OGGARv8OIIEav9rM",
    "name": "Infinity Books Japan",
    "category": "bookstore",
    "placedBy": "memory?",
    "reasons": [
      "Bookstore turns up 1 times in your photos and saved places.",
      "For “old bookstores”: it is a bookstore.",
      "A 4-minute walk from Tokyo Origami Museum."
    ],
    "memoryRefs": [
      "mem_eval_r2_bookstores"
    ],
    "runnerUp": null
  },
  {
    "itemId": "item_d2_dinner",
    "day": 3,
    "role": "dinner",
    "time": "18:00-19:30",
    "placeId": "ChIJrbVk2baOGGARq3K1Twk44T4",
    "name": "Sushi Kikumasa",
    "category": "sushi",
    "placedBy": "ranking",
    "reasons": [
      "A 3-minute walk from KURAMAE CANNELE.",
      "Keeps Day 3 close together.",
      "Chosen over Ult II House-made Noodles, which is further from the rest of the day."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJp48A5CmPGGARKRQ2sNnJHCc",
      "name": "Ult II House-made Noodles",
      "score": 0.448,
      "lostOn": "routeFit"
    }
  },
  {
    "itemId": "item_d2_nightcap",
    "day": 3,
    "role": "nightcap",
    "time": "21:00-22:15",
    "placeId": "ChIJXQN4ucaOGGARhxf9DhcXAZ0",
    "name": "Soba Udon Monju Asakusa Branch",
    "category": "bar_cocktail",
    "placedBy": "ranking",
    "reasons": [
      "A 5-minute walk from Infinity Books Japan.",
      "Keeps Day 3 close together.",
      "Chosen over Pub Shamrock Asakusa, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJBSscVQCPGGARiewQXfqwUW4",
      "name": "Pub Shamrock Asakusa",
      "score": 0.443,
      "lostOn": "cost"
    }
  },
  {
    "itemId": "item_d3_main_destination",
    "day": 4,
    "role": "main_destination",
    "time": "10:00-11:00",
    "placeId": "ChIJZeLCusqOGGARuV76qbNiFkY",
    "name": "Former Yasuda Garden",
    "category": "park_garden",
    "placedBy": "ranking",
    "reasons": [
      "A 7-minute walk from Kuramae.",
      "Chosen over SKYTREE GALLERY, which is farther from Kuramae."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJP7KkV1ePGGARnAp_ETT56kA",
      "name": "SKYTREE GALLERY",
      "score": 0.325,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d3_lunch",
    "day": 4,
    "role": "lunch",
    "time": "12:45-13:30",
    "placeId": "ChIJxUP_Y-iJGGAR1Mm00ouCVUM",
    "name": "Icchome Sabou",
    "category": "cafe_kissaten",
    "placedBy": "ranking",
    "reasons": [
      "For “kissaten”: it is a cafe or kissaten.",
      "A 4-minute walk from Former Yasuda Garden.",
      "Chosen over Coffee Wrights Kuramae, which is farther from Former Yasuda Garden."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJT52xaLeOGGAR6ZstEJFAmF0",
      "name": "Coffee Wrights Kuramae",
      "score": 0.522,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d3_extension_2",
    "day": 4,
    "role": "extension_2",
    "time": "14:00-15:00",
    "placeId": "ChIJxyK9lrGOGGARg15egohj6PI",
    "name": "Kamifuku Books",
    "category": "bookstore",
    "placedBy": "memory?",
    "reasons": [
      "Bookstore turns up 1 times in your photos and saved places.",
      "For “old bookstores”: it is a bookstore.",
      "A 10-minute walk from Former Yasuda Garden."
    ],
    "memoryRefs": [
      "mem_eval_r2_bookstores"
    ],
    "runnerUp": null
  },
  {
    "itemId": "item_d3_dinner",
    "day": 4,
    "role": "dinner",
    "time": "18:00-18:45",
    "placeId": "ChIJp48A5CmPGGARKRQ2sNnJHCc",
    "name": "Ult II House-made Noodles",
    "category": "ramen",
    "placedBy": "ranking",
    "reasons": [
      "A 11-minute walk from Icchome Sabou.",
      "Keeps Day 4 close together.",
      "Chosen over Sunaba, which is better known."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJyTcpS8mOGGAReugcT5Q1xXI",
      "name": "Sunaba",
      "score": 0.428,
      "lostOn": "novelty"
    }
  },
  {
    "itemId": "item_d3_nightcap",
    "day": 4,
    "role": "nightcap",
    "time": "21:00-22:15",
    "placeId": "ChIJsw0inamPGGARML0W6O84DPY",
    "name": "Neko Naraku Cafe & Bar",
    "category": "bar_cocktail",
    "placedBy": "ranking",
    "reasons": [
      "A 6-minute walk from Kamifuku Books.",
      "Keeps Day 4 close together.",
      "Chosen over The Kakeru Kuramae, which is further from the rest of the day."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJeYWAcpWPGGAR39e1fBG_HFY",
      "name": "The Kakeru Kuramae",
      "score": 0.425,
      "lostOn": "routeFit"
    }
  },
  {
    "itemId": "item_d4_main_destination",
    "day": 5,
    "role": "main_destination",
    "time": "10:00-11:30",
    "placeId": "ChIJP7KkV1ePGGARnAp_ETT56kA",
    "name": "SKYTREE GALLERY",
    "category": "museum_gallery",
    "placedBy": "ranking",
    "reasons": [
      "2.0 km from Kuramae.",
      "Chosen over RYUICHI SAKAMOTO + SHIRO TAKATANI AMBIENT KYOTO - TOKYO, which is farther from Kuramae."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJe5n9LgCLGGARE2_t14iLwn8",
      "name": "RYUICHI SAKAMOTO + SHIRO TAKATANI AMBIENT KYOTO - TOKYO",
      "score": 0.286,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d4_lunch",
    "day": 5,
    "role": "lunch",
    "time": "12:45-13:30",
    "placeId": "ChIJT52xaLeOGGAR6ZstEJFAmF0",
    "name": "Coffee Wrights Kuramae",
    "category": "cafe_kissaten",
    "placedBy": "ranking",
    "reasons": [
      "For “kissaten”: it is a cafe or kissaten.",
      "Keeps Day 5 close together.",
      "Chosen over En, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJ6V60sbeOGGAReGyMGPYPeZU",
      "name": "En",
      "score": 0.44,
      "lostOn": "cost"
    }
  },
  {
    "itemId": "item_d4_extension_2",
    "day": 5,
    "role": "extension_2",
    "time": "14:00-15:00",
    "placeId": "ChIJbYldo2WPGGARUphfxmlPtSw",
    "name": "WESTSIDE COFFEE KURAMAE",
    "category": "grocery_market",
    "placedBy": "ranking",
    "reasons": [
      "Keeps Day 5 close together.",
      "Not a tourist fixture — 48 reviews.",
      "Chosen over 藝州 三國屋 蔵前店, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJE-xvWJiPGGARpSGWsUM8uIM",
      "name": "藝州 三國屋 蔵前店",
      "score": 0.447,
      "lostOn": "cost"
    }
  },
  {
    "itemId": "item_d4_dinner",
    "day": 5,
    "role": "dinner",
    "time": "18:00-19:45",
    "placeId": "ChIJmwPWxbeOGGARR85ktv868QU",
    "name": "Okuman",
    "category": "izakaya",
    "placedBy": "ranking",
    "reasons": [
      "A 3-minute walk from Coffee Wrights Kuramae.",
      "Keeps Day 5 close together.",
      "Chosen over Sunaba, which is farther from Coffee Wrights Kuramae."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJyTcpS8mOGGAReugcT5Q1xXI",
      "name": "Sunaba",
      "score": 0.437,
      "lostOn": "convenience"
    }
  },
  {
    "itemId": "item_d4_nightcap",
    "day": 5,
    "role": "nightcap",
    "time": "21:00-22:15",
    "placeId": "ChIJGW7xTZaPGGAR8a7GG5Bayx0",
    "name": "Stage",
    "category": "bar_cocktail",
    "placedBy": "ranking",
    "reasons": [
      "A 1-minute walk from WESTSIDE COFFEE KURAMAE.",
      "Keeps Day 5 close together.",
      "Chosen over PHERMENT BREWING, which is pricier."
    ],
    "memoryRefs": [],
    "runnerUp": {
      "placeId": "ChIJpaEV8U-NGGAR4M9euLVRX3c",
      "name": "PHERMENT BREWING",
      "score": 0.424,
      "lostOn": "cost"
    }
  }
]
```
## Audit
```json
{
  "selected": [
    {
      "placeId": "ChIJWQSdSLaOGGARk7qGNVyECxI",
      "name": "Kuramae Park",
      "slot": "Day 1 main_destination",
      "neutralRank": 7,
      "whyWon": {
        "placedBy": "ranking",
        "reasons": [
          "For “small independent cultural places”: its description mentions “small”.",
          "A 1-minute walk from Kuramae.",
          "Chosen over The Yogodo Hall, which is farther from Kuramae."
        ],
        "beat": "The Yogodo Hall (0.466), which lost most on convenience"
      }
    },
    {
      "placeId": "ChIJjZFyLquPGGARgPO6dprcE9M",
      "name": "snaq.me stand Kuramae",
      "slot": "Day 1 lunch",
      "neutralRank": 6,
      "whyWon": {
        "placedBy": "ranking",
        "reasons": [
          "For “kissaten”: it is a cafe or kissaten.",
          "A 2-minute walk from Kuramae Park.",
          "Chosen over SUNDAE APART, which is pricier."
        ],
        "beat": "SUNDAE APART (0.569), which lost most on cost"
      }
    },
    {
      "placeId": "ChIJkX42vLeOGGARszgelkFQv9g",
      "name": "Okuramae Shobō",
      "slot": "Day 1 extension_2",
      "neutralRank": 1,
      "whyWon": {
        "placedBy": "ranking",
        "reasons": [
          "Bookstore turns up 1 times in your photos and saved places.",
          "For “old bookstores”: its description mentions “bookstore”.",
          "Chosen over Infinity Books Japan, which is farther from Kuramae Park."
        ],
        "beat": "Infinity Books Japan (0.664), which lost most on convenience"
      }
    }
  ],
  "rejected": [
    {
      "placeId": "ChIJ3RqD4zSPGGARkgV-WNO_sYA",
      "name": "Tōmei Bookstore",
      "category": "bookstore",
      "neutralRank": 2,
      "neutralScore": 0.704,
      "whyLost": "RANKING/CONTEXT: eligible for extension_2 but never in a slot's top 6 once day geography, hours and used places applied"
    },
    {
      "placeId": "ChIJjbNYOACPGGARHjKCX5UPco4",
      "name": "SUNDAE APART",
      "category": "cafe_kissaten",
      "neutralRank": 9,
      "neutralScore": 0.573,
      "whyLost": "RANKING: runner-up for Day 1 lunch, lost to snaq.me stand Kuramae on cost (0.569 vs winner)"
    },
    {
      "placeId": "ChIJ8UvpbOCPGGARiHO0jyfGqvU",
      "name": "Kissa Hangetsu",
      "category": "cafe_kissaten",
      "neutralRank": 12,
      "neutralScore": 0.538,
      "whyLost": "RANKING: runner-up for Day 1 lunch, lost to snaq.me stand Kuramae on novelty (0.531 vs winner)"
    }
  ]
}
```