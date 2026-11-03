import type { Trip } from '../domain/trip';

export const demoTrip: Trip = {
  id: 'demo-coastal-weekend',
  name: 'The Coastal Classic',
  locationLabel: 'Imaginary Coast',
  dateLabel: 'A fictional five-day getaway',
  golfers: [
    { id: 'golfer-01', displayName: 'Alex Fairway' },
    { id: 'golfer-02', displayName: 'Blake Birdie' },
    { id: 'golfer-03', displayName: 'Casey Green' },
    { id: 'golfer-04', displayName: 'Devon Links' },
    { id: 'golfer-05', displayName: 'Ellis Putter' },
    { id: 'golfer-06', displayName: 'Finley Bunker' },
    { id: 'golfer-07', displayName: 'Gray Eagle' },
    { id: 'golfer-08', displayName: 'Harper Dunes' },
    { id: 'golfer-09', displayName: 'Indigo Tee' },
    { id: 'golfer-10', displayName: 'Jules Wedge' },
    { id: 'golfer-11', displayName: 'Kit Meadow' },
    { id: 'golfer-12', displayName: 'Lane Caddie' },
  ],
  rounds: [
    { id: 'round-01', number: 1, courseName: 'Windward Dunes', dayLabel: 'Day one', teeTimeLabel: '9:00 AM' },
    { id: 'round-02', number: 2, courseName: 'Cypress Hollow', dayLabel: 'Day two', teeTimeLabel: '8:30 AM' },
    { id: 'round-03', number: 3, courseName: 'Saltwater Links', dayLabel: 'Day three', teeTimeLabel: '9:10 AM' },
    { id: 'round-04', number: 4, courseName: 'The Sandpiper', dayLabel: 'Day four', teeTimeLabel: '8:40 AM' },
    { id: 'round-05', number: 5, courseName: 'Windward Dunes', dayLabel: 'Day five', teeTimeLabel: '9:00 AM' },
  ],
};
