# Cluedo Robot Players

Robot players for a real game of Cluedo (or Clue). The robots are dealt cards and answer suggestions, so two people can play like a full table. They don't move or ask questions.

Play it at **https://jordykaufman.github.io/cloodobots/**. Open the page on a phone, list the players in seating order, and start.

## What it does

- **Robots that answer.** When someone makes a suggestion, the app goes round the table clockwise from the asker's left. The first player who holds one of the three cards shows one. If that's a robot, the card appears privately on the asker's phone. A "cagey" robot re-shows a card it has already shown when it can.
- **Real cards or app cards.** Deal the people real cards and tap them in, or let the app deal everyone.
- **Envelope scan.** With real cards, the phone lies face-down on the table and reads the three envelope cards with its camera as you hold each one face-down above it. Nobody sees them, the screen never shows them, and the app then knows the real answer. If the camera can't be used, the app picks the answer from the cards nobody holds instead. That gives the same odds, but the paper envelope isn't used. See `scan-explained.html`.
- **Your own cards on screen.** With the Clue (2013) card set, the game shows photos of the real cards (`cards/clue2013/`) when a card is revealed, suggested or solved.
- **One phone or several.** Pass one phone around, or let each person join on their own phone with a five-letter code or QR code. The host phone holds the game. Other phones only ever receive their own players' cards.

## How it's built

A static site with no build step. Plain ES modules, plus three libraries loaded from jsDelivr when needed:

| Library | Used for |
| --- | --- |
| [PeerJS](https://peerjs.com) 1.5.5 | Linking phones. PeerJS's free public server introduces the phones; game messages then go directly between them over WebRTC. |
| [Tesseract.js](https://tesseract.projectnaptha.com) 7.0.0 | Reading card names from the camera, on the phone. |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 2.0.4 | The join QR code. |

| File | What's in it |
| --- | --- |
| `js/engine.js` | Game rules and state. Runs only on the host phone. `modelFor()` builds what each phone may see. |
| `js/views.js` | Every screen, drawn from that model. |
| `js/main.js` | Host and joining-phone wiring, screen state, buttons, the scanner. |
| `js/net.js` | The PeerJS link. |
| `js/scan.js`, `js/vision.js`, `js/match.js` | Camera, finding and straightening the card, reading and matching its name. The scanner reads only small boxes near the bottom of the card where the name is printed, because the picture beside the name confuses the text reader. |
| `cards/clue2013/` | Photos of the 2013 Clue cards, 420 pixels wide. |
| `js/backs.js`, `js/markers.js` | Reads printed card backs from one photo of cards laid face-down: finds the corner marks, fits each card's circle and reads the ring of ticks round it, then groups the cards into rows. |
| `card-test.html`, `js/card-test.js`, `js/live-scan.js`, `js/backs-worker.js` | Try the card back reader on printed cards. Scan live: a full-screen camera view that reads every frame (in a worker, so the view stays smooth), puts a green tick and the card's name on each card once it's identified (a red "?" on a card it can't read, unless it's one already identified whose ring a reflection hid in that frame), and keeps count across frames, so the phone can be held over all the cards or moved slowly across the table. A card counts at once when its ring reads cleanly (at most 6 of 72 ticks wrong; any two cards differ in at least 25), or else once it has been read twice within five reads, and goes on a map of the table (`js/table-map.js`): cards already on the map line each new view up, each step measured at the scale of the cards it runs between (a phone held at an angle sees the far side smaller), so the rows come out right even when no single view holds every card, and parts of the table never seen together stay separate groups until a view shows cards from both. Counted cards keep a tick in the camera view, placed by the map, whether or not they're read again, and a frame too blurred to make out any card leaves the ticks as they were rather than wiping them. Told how many cards to find (all 21 by default), the scan chimes and stops the moment it has them, naming the last few still to find; told "however many there are", it stops once no new card has turned up and the phone has been held still for 0.7 s, with every card in view read. Done ends it by hand. A mini-map shows what's been counted (green), cards seen but not read yet (red outlines, kept in place on the map until they're read), and where the camera is (a white box); it's scaled to the cards, so it doesn't jump about as the phone moves. The line of text at the top says what most of the last few reads found and stays up for at least 0.8 s, so it doesn't flicker. Or read one photo. A tally counts every card seen across scans, and the save button hands the picture on, to Google Drive or a message, so the reader can be tuned on real photos. |
| `tools/` | `make_markers.py` makes the marker codes; `test_sheet.py` draws `print/card-back-test-sheet.pdf`; `print_cards.py` makes print files for a deck from MakePlayingCards. |

The camera needs HTTPS (or `localhost`), so serve the folder from somewhere like GitHub Pages.

## Tests

```
npm test
```

Runs the rule and name-matching tests with Node's built-in test runner. No install needed.

## Card backs you print yourself

Every card back carries the same 8 mm mark in each corner, the bottom two turned round, so the back is the same picture either way up. Those marks only tell the camera where the card lies. The card's code is the ring of graduations round the compass rose: a tick every 5°, each long or short, drawn faint; any two cards differ in at least 24 of the 72 ticks, however they lie. A fanned hand shows nothing but identical corners, and on the table every back looks the same at a glance. The reader finds the marks, checks there is a brass circle where they say the card's centre is (which is also how it tells a real card from marks of neighbouring cards that happen to line up), fits that circle, and reads the ticks round it.

`print/card-back-test-sheet-bezel.pdf` has the 21 backs at 63 × 88 mm with instructions; `print/card-back-test-sheet-bezel-us-game-double-sided.pdf` has them at the size of real Clue cards, with plain fronts on the other side. Lay the cards face-down in rows, one row per player plus one for the envelope, and one photo tells the app who holds what. On simulated photos with tilt, turned cards, blur and glare, the reader placed every card correctly except under glare strong enough to wash the faint ring out, and those it reports as cards it could see but not read, never as a wrong card. `print/card-back-test-sheet.pdf` is the older layout, with the card's own marker in two corners, plus a page of marker sizes and shades to test a printer and camera.

To order a proper deck, `python3 tools/print_cards.py OUT_DIR [FRONTS_DIR ...]` makes one image per card back, and per front if you give it a folder of fronts named after the cards (`scarlet.png`, `lead_pipe.jpg`). They follow MakePlayingCards' US game template, the size of real Clue cards: 2.2 × 3.43 in with 0.12 in of bleed on every side, at 600 dpi (1464 × 2202 pixels), with everything important inside their safe area, 0.1 in inside the cut. On these narrower cards the marks sit 5.25 mm in from the edge, and the reader knows both sizes, so home-printed test cards and the ordered deck both read. `OUT_DIR/proof.png` shows every card with the cut line and safe area drawn on. The fronts aren't in this repository.

## Known limits

- The scanner was tuned on simulated camera views of photos of the real 2013 cards, where it read 83% of single frames correctly and never misread one, and it reads frames continuously while a card is held. It hasn't been tried with a real phone camera yet. Lighting and how high you hold the card will matter. The torch turns on automatically where the phone allows it.
- Card names in the setup must match what's printed on your cards, so the scanner can recognise them.
- Joining phones need to reach PeerJS's public server and a direct connection to the host phone. That works on most home Wi-Fi, but some networks block it.

## Ideas for later

- **Keep the card photos off the internet.** The photos in `cards/clue2013/` are served publicly with the site. Instead, the host phone could load them once from its photo library, the browser would keep them, and joined phones would get them from the host over the game link.
- **NFC stickers instead of the camera.** A sticker on the back of every card would let the envelope be scanned by tapping each card against the phone. Web pages can only read NFC in Chrome on Android, not on iPhones.
- **The beach board.** Photos of its six rooms are already in `cards/clue2013/`; it needs a card set with those rooms.
- **Robots as full players** that move and make their own suggestions.
