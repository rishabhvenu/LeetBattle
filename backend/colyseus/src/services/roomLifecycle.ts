import type { Room } from 'colyseus';

export interface RoomLifecycleOptions {
  autoDispose?: boolean;
  seatReservationSeconds?: number;
  isPrivate?: boolean;
}

export function configureRoomLifecycle(room: Room, options: RoomLifecycleOptions = {}) {
  const { autoDispose = false, seatReservationSeconds, isPrivate } = options;

  (room as any).autoDispose = autoDispose;

  if (typeof (room as any).setSeatReservationTime === 'function' && typeof seatReservationSeconds === 'number') {
    (room as any).setSeatReservationTime(seatReservationSeconds);
  }

  if (typeof (room as any).setPrivate === 'function' && typeof isPrivate === 'boolean') {
    (room as any).setPrivate(isPrivate);
  }

  if (typeof room.unlock === 'function') {
    room.unlock();
  }
}

