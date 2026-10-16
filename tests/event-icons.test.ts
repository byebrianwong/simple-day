import { describe, expect, it } from 'vitest';
import { ICON_RULES, iconForTitle } from '@/lib/event-icons';
import { ICON_SHAPES } from '@/lib/icon-shapes';

describe('iconForTitle', () => {
  it.each([
    ['Doctor: Dr. Lee', 'stethoscope'],
    ['Dr. Patel', 'stethoscope'],
    ['Pickup for Doctor', 'stethoscope'],
    ['Eye doctor', 'glasses'],
    ['Dentist appointment', 'toothbrush'],
    ['Hair appointment', 'scissors'],
    ['Breakfast and morning pills', 'pill'],
    ['Lunch with Brian', 'utensils'],
    ['Test event: Dinner', 'utensils'],
    ['Coffee with Maria', 'coffee'],
    ['Café with Ann', 'coffee'],
    ['Phone call from Susan', 'phone'],
    ['Walk with Maria', 'footprints'],
    ['Birthday party', 'cake'],
    ['Bingo with friends', 'dices'],
    ['Book club', 'book-open'],
    ['Drive to church', 'church'],
    ['Grocery shopping', 'shopping-cart'],
    ['Susan visits', 'users'],
    ['Test: Circle of Friends', 'users'],
    ['Trash day', 'trash-2'],
    ['Evening news', 'tv'],
    ['Take the dog to the vet', 'paw-print'],
    ['Water plants', 'flower-2'],
  ])('"%s" gets %s', (title, icon) => {
    expect(iconForTitle(title)).toBe(icon);
  });

  it('matches whole words only', () => {
    expect(iconForTitle('Bread baking')).toBeUndefined(); // not "read"
    expect(iconForTitle('Restore photos')).toBeUndefined(); // not "rest" or "store"
    expect(iconForTitle('Dread')).toBeUndefined();
  });

  it('returns nothing for an empty or unmatched title', () => {
    expect(iconForTitle('')).toBeUndefined();
    expect(iconForTitle('Something unusual')).toBeUndefined();
  });
});

describe('icon shapes', () => {
  it('has a drawing for every picture the rules use', () => {
    for (const rule of ICON_RULES) expect(ICON_SHAPES[rule.icon], rule.icon).toBeTruthy();
  });
});
