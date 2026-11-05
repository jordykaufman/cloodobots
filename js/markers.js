// Card-back markers, made by tools/make_markers.py. Don't edit by hand.
// Each is 36 squares (6 rows of 6, top row first; 1 = ink) inside a solid ring.
// Any two differ in at least 10 squares however they are turned.
export const MARKERS = [
"000000010010101111100000101001100100",
"110010101010000100100100001011011111",
"010001101111110110011100101110001010",
"101010101101100010101110100111100001",
"001011100001100111101011011011101101",
"110000100111011001011110011011010011",
"010001110011001101101100011101000111",
"000101000011011101100010111110101010",
"010110001000000000111100100011001011",
"101100100110011111000010101101000001",
"101011001011001000110101011001011110",
"110010010100000100000011111100101001",
"101101011001110101100100010111100001",
"000101100011100110111010000110010110",
"011100101000000011011100000100111010",
"010101010010001011111010110101010101",
"100111101101110001011010101001111100",
"011101101111110010000110110000010011",
"000111100111011101010000100010010011",
"111000110111001001000100000100000111",
"011101101010101101110100001000001110",
"001000101010100110010110010011110111",
"111011101111000010001000011101011001",
"100101001111111110100000101111001101",
"100100001100000011010111001011110000",
"100010111010101100010011110001001001",
"101111000001111010101110001111011101",
"110110100010110011001101111000011000",
"000110110011010111101011001101010111",
"100011110110011000110111001001111101",
"010001000101111011100001001001001010",
"010111110110011110000010111110101110",
"100001011001110000101111000101010000",
"110101110101101000100100011111111011",
"100111101010010101100101011010110010",
"111001100110001100110010010101001101",
"000101101011011001001010110100001101",
"110010001100110101001011010010110100"
];

// Marker 0 is the decoy printed in two corners of every card.
export const DECOY = 0;

// Which marker each card of our printed deck carries: the cards of Clue (2013), house
// rooms only. Markers 22-33 are only used on the size test page.
export const CARD_MARKERS = {
  "Scarlet": 1,
  "Mustard": 2,
  "White": 3,
  "Green": 4,
  "Peacock": 5,
  "Plum": 6,
  "Candlestick": 7,
  "Dagger": 8,
  "Lead Pipe": 9,
  "Pistol": 10,
  "Rope": 11,
  "Wrench": 12,
  "Bathroom": 13,
  "Bedroom": 14,
  "Courtyard": 15,
  "Dining Room": 16,
  "Game Room": 17,
  "Garage": 18,
  "Kitchen": 19,
  "Living Room": 20,
  "Office": 21
};

// The corner-mark layout: every card carries the same four marks, standing for 1 to 4,
// one in each corner, and the card is told apart by which corner holds which. These
// are the markers for marks 1, 2, 3 and 4, chosen to look like noise so a person
// can't see which way up a card lies.
export const CORNER_MARKS = [34, 35, 36, 37];

// Each card's corners, read from the top-left corner going counterclockwise (top left,
// bottom left, bottom right, top right). "2413" puts mark 2 top left, 4 bottom left,
// 1 bottom right and 3 top right. The marks all face the card's top, which is how the
// reader knows where to start. The orders are shared out so that no single corner
// hints at whether a card is a suspect, weapon or room.
export const CARD_CORNERS = {
  "Scarlet": "3412",
  "Mustard": "1243",
  "White": "2314",
  "Green": "4132",
  "Peacock": "1423",
  "Plum": "4321",
  "Candlestick": "4312",
  "Dagger": "1432",
  "Lead Pipe": "4213",
  "Pistol": "1324",
  "Rope": "2143",
  "Wrench": "3241",
  "Bathroom": "1342",
  "Bedroom": "2341",
  "Courtyard": "2413",
  "Dining Room": "3214",
  "Game Room": "4231",
  "Garage": "3142",
  "Kitchen": "4123",
  "Living Room": "1234",
  "Office": "3421"
};
