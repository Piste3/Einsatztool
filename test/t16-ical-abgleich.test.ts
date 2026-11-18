// T16: iCal-Abgleich mit Feed: gleicher Termin, andere Zeit, ohne Termin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gleicheAb, type FeedTermin } from '../src/domain/ical-abgleich.js';
import { leseFeed } from '../src/jobs/ical-cache.js';

test('T16 Abgleich ergibt ok, zeit_abweicht und fehlt', () => {
  const feed: FeedTermin[] = [
    { titel: '  Herbstmesse   2026 ', start: '2026-10-24T07:00:00Z', ende: '2026-10-24T15:00:00Z' },
    { titel: 'Stadtlauf – Schicht 1', start: '2026-11-28T08:00:00Z', ende: '2026-11-28T12:00:00Z' },
  ];
  assert.equal(gleicheAb('herbstmesse 2026', '2026-10-24T07:00:00Z', '2026-10-24T15:00:00Z', feed).status, 'ok');
  assert.equal(gleicheAb('Stadtlauf – Schicht 1', '2026-11-28T08:00:00Z', '2026-11-28T13:00:00Z', feed).status, 'zeit_abweicht');
  assert.equal(gleicheAb('slowUp', '2026-11-28T08:00:00Z', '2026-11-28T13:00:00Z', feed).status, 'fehlt');
  assert.equal(gleicheAb('slowUp', '2026-11-28T08:00:00Z', '2026-11-28T13:00:00Z', null).status, 'unbekannt');
});

test('T16 Feed aus iCal-Text lesen', () => {
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:1@clubdesk', 'DTSTART:20261024T070000Z', 'DTEND:20261024T150000Z',
    'SUMMARY:Herbstmesse 2026', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const termine = leseFeed(text);
  assert.deepEqual(termine, [{ titel: 'Herbstmesse 2026', start: '2026-10-24T07:00:00Z', ende: '2026-10-24T15:00:00Z' }]);
});
