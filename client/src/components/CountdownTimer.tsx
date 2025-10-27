import React, { useState, useEffect } from "react";

interface CountdownTimerProps {
  matchStartTime: number | null;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({ matchStartTime }) => {
  const [timeLeft, setTimeLeft] = useState({ hours: 0, minutes: 45, seconds: 0 });

  useEffect(() => {
    if (!matchStartTime) {
      setTimeLeft({ hours: 0, minutes: 45, seconds: 0 });
      return;
    }

    // Calculate time remaining based on start time
    const calculateTimeLeft = () => {
      const now = Date.now();
      const maxDuration = 45 * 60 * 1000; // 45 minutes in milliseconds
      const elapsed = now - matchStartTime;
      const remaining = maxDuration - elapsed;

      if (remaining > 0) {
        return {
          hours: Math.floor(remaining / (1000 * 60 * 60)),
          minutes: Math.floor((remaining / 1000 / 60) % 60),
          seconds: Math.floor((remaining / 1000) % 60),
        };
      }

      return { hours: 0, minutes: 0, seconds: 0 };
    };

    // Update immediately
    setTimeLeft(calculateTimeLeft());

    // Then update every second
    const interval = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(interval);
  }, [matchStartTime]);

  const formatTime = (value: number) => value.toString().padStart(2, "0");

  return (
    <div className="countdown-timer">
      {timeLeft.hours > 0 || timeLeft.minutes > 0 || timeLeft.seconds > 0 ? (
        <span>
          {formatTime(timeLeft.hours)}:{formatTime(timeLeft.minutes)}:
          {formatTime(timeLeft.seconds)}
        </span>
      ) : (
        <span>Time&apos;s up!</span>
      )}
    </div>
  );
};

export default CountdownTimer;
