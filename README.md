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
| `js/backs.js`, `js/markers.js` | Reads the markers on printed card backs from one photo of cards laid face-down, and groups the cards into rows. |
| `card-test.html` | Try the card back reader with a photo of the printed test sheet. |
| `tools/` | `make_markers.py` makes the marker codes; `test_sheet.py` draws `print/card-back-test-sheet.pdf`. |

The camera needs HTTPS (or `localhost`), so serve the folder from somewhere like GitHub Pages.

## Tests

```
npm test
```

Runs the rule and name-matching tests with Node's built-in test runner. No install needed.

## Card backs you print yourself

`print/card-back-test-sheet.pdf` has 21 card backs with an 8 mm marker in each corner: two carry the card's code and two are a decoy shared by every card. Lay the cards face-down in rows, one row per player plus one for the envelope, and one photo tells the app who holds what. On simulated photos of the sheet, with tilt, rotated cards, blur and glare, the reader placed every card correctly in all 28 photos where the markers were at least 34 pixels across, and never misread a card.

## Known limits

- The scanner was tuned on simulated camera views of photos of the real 2013 cards, where it read 83% of single frames correctly and never misread one, and it reads frames continuously while a card is held. It hasn't been tried with a real phone camera yet. Lighting and how high you hold the card will matter. The torch turns on automatically where the phone allows it.
- Card names in the setup must match what's printed on your cards, so the scanner can recognise them.
- Joining phones need to reach PeerJS's public server and a direct connection to the host phone. That works on most home Wi-Fi, but some networks block it.

## Ideas for later

- **Keep the card photos off the internet.** The photos in `cards/clue2013/` are served publicly with the site. Instead, the host phone could load them once from its photo library, the browser would keep them, and joined phones would get them from the host over the game link.
- **NFC stickers instead of the camera.** A sticker on the back of every card would let the envelope be scanned by tapping each card against the phone. Web pages can only read NFC in Chrome on Android, not on iPhones.
- **The beach board.** Photos of its six rooms are already in `cards/clue2013/`; it needs a card set with those rooms.
- **Robots as full players** that move and make their own suggestions.
