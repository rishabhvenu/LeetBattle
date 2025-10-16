import React, { useEffect, useRef, useState } from "react";
import { useSpring, animated, config } from "react-spring";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Crown, Scale, Home, Swords } from "lucide-react";
import { getAvatarUrl } from "@/lib/utils";
import { Button } from "./ui/button";

interface PlayerInfo {
  name: string;
  username: string;
  avatar: string | null;
  initials: string;
  isWinner: boolean;
  ratingChange?: {
    oldRating: number;
    newRating: number;
    change: number;
  };
}

interface MatchResultAnimationProps {
  player1: PlayerInfo;
  player2: PlayerInfo;
  onBackToHome: () => void;
  onJoinQueue: () => void;
}

const MatchResultAnimation: React.FC<MatchResultAnimationProps> = ({
  player1,
  player2,
  onBackToHome,
  onJoinQueue,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef(false);
  const isDraw = !player1.isWinner && !player2.isWinner;
  const [showButtons, setShowButtons] = useState(false);

  useEffect(() => {
    // Play sound only once
    if (!hasPlayedRef.current) {
      audioRef.current = new Audio("/sword-clash.mp3");
      audioRef.current
        .play()
        .catch((error) => console.warn("Error playing sound:", error));
      hasPlayedRef.current = true;
    }

    // Show buttons after animation completes
    const timer = setTimeout(() => {
      setShowButtons(true);
    }, 2500);
    
    return () => {
      clearTimeout(timer);
      // Stop audio if component unmounts
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, []);

  const [leftSwordProps] = useSpring(() => ({
    from: { transform: "translateX(-100%) rotate(45deg)" },
    to: {
      transform: isDraw
        ? "translateX(-60%) rotate(0deg)"
        : player1.isWinner
        ? "translateX(-10%) rotate(0deg)"
        : "translateX(-30%) rotate(90deg)",
    },
    config: { ...config.wobbly, duration: 1000 },
  }));

  const [rightSwordProps] = useSpring(() => ({
    from: { transform: "translateX(100%) rotate(-45deg)" },
    to: {
      transform: isDraw
        ? "translateX(60%) rotate(0deg)"
        : player2.isWinner
        ? "translateX(10%) rotate(0deg)"
        : "translateX(30%) rotate(-90deg)",
    },
    config: { ...config.wobbly, duration: 1000 },
  }));

  const [crownProps] = useSpring(() => ({
    from: { opacity: 0, transform: "translateY(-20px)" },
    to: { opacity: 1, transform: "translateY(0px)" },
    config: { tension: 300, friction: 10 },
    delay: 500,
  }));

  const [scaleProps] = useSpring(() => ({
    from: { opacity: 0, transform: "scale(0.5)" },
    to: { opacity: 1, transform: "scale(1)" },
    config: { tension: 300, friction: 10 },
    delay: 500,
  }));

  // Helper function to render profile picture
  const renderProfilePicture = (avatar: string | null, initials: string, isWinner: boolean, isDraw: boolean) => {
    const avatarClasses = `w-24 h-24 ${
      isWinner
        ? "ring-4 ring-yellow-400 shadow-lg shadow-yellow-400/50"
        : isDraw
        ? "ring-4 ring-blue-400 shadow-lg shadow-blue-400/50"
        : ""
    }`;

    return (
      <Avatar className={avatarClasses}>
        <AvatarImage
          src={getAvatarUrl(avatar)}
          alt="Profile"
        />
        <AvatarFallback className="bg-gray-200">
          <img 
            src="/placeholder_avatar.png"
            alt="Profile placeholder"
            className="w-full h-full object-cover"
          />
        </AvatarFallback>
      </Avatar>
    );
  };

  const PlayerDisplay = ({ player }: { player: PlayerInfo }) => (
    <div className="flex flex-col items-center">
      <div className="relative">
        {player.isWinner && (
          <animated.div
            style={crownProps}
            className="absolute -top-10 inset-x-0 mx-auto flex items-center justify-center"
          >
            <Crown className="w-8 h-8 text-yellow-400 drop-shadow-[0_0_8px_rgba(255,215,0,0.7)]" />
          </animated.div>
        )}
        {renderProfilePicture(player.avatar, player.initials, player.isWinner, isDraw)}
      </div>
      <span className="mt-2 text-slate-200 font-bold text-lg">
        {player.name}
      </span>
      <span className="text-slate-400 text-sm">@{player.username}</span>
      <span
        className={`mt-2 font-bold text-xl ${
          player.isWinner
            ? "text-yellow-400 drop-shadow-[0_0_10px_rgba(255,215,0,0.7)]"
            : isDraw
            ? "text-blue-400 drop-shadow-[0_0_10px_rgba(0,128,255,0.7)]"
            : "text-red-500"
        }`}
      >
        {player.isWinner ? "Winner" : isDraw ? "Draw" : "Loser"}
      </span>
      {player.ratingChange && (
        <div className="mt-3 flex flex-col items-center gap-1">
          <div className="text-slate-300 text-sm">
            {player.ratingChange.oldRating} → {player.ratingChange.newRating}
          </div>
          <div
            className={`font-bold text-lg ${
              player.ratingChange.change > 0
                ? "text-green-400"
                : player.ratingChange.change < 0
                ? "text-red-400"
                : "text-slate-400"
            }`}
          >
            {player.ratingChange.change > 0 ? "+" : ""}
            {player.ratingChange.change}
          </div>
        </div>
      )}
    </div>
  );

  const [buttonProps] = useSpring(() => ({
    from: { opacity: 0, transform: "translateY(20px)" },
    to: { 
      opacity: showButtons ? 1 : 0, 
      transform: showButtons ? "translateY(0px)" : "translateY(20px)" 
    },
    config: { tension: 300, friction: 20 },
  }), [showButtons]);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md"></div>
      <div className="relative flex flex-col items-center justify-center gap-12 z-10">
        <div className="flex items-center justify-center gap-12">
          <PlayerDisplay player={player1} />

          {/* Swords in the middle */}
          <div className="relative w-80 h-48 flex items-center justify-center">
            {isDraw && (
              <animated.div
                style={scaleProps}
                className="absolute inset-0 flex items-center justify-center z-20"
              >
                <Scale className="w-20 h-20 text-blue-400 drop-shadow-[0_0_8px_rgba(0,128,255,0.7)]" />
              </animated.div>
            )}
            <animated.div
              style={leftSwordProps}
              className="w-24 h-48 absolute left-1/2 -ml-12 z-10"
            >
              <img
                src="/sword-left.svg"
                alt="Left sword"
                className={`w-full h-full ${
                  player1.isWinner || isDraw
                    ? "filter brightness-125 drop-shadow-[0_0_8px_rgba(255,215,0,0.7)]"
                    : "filter brightness-75"
                }`}
              />
            </animated.div>
            <animated.div
              style={rightSwordProps}
              className="w-24 h-48 absolute right-1/2 -mr-12 z-10"
            >
              <img
                src="/sword-right.svg"
                alt="Right sword"
                className={`w-full h-full ${
                  player2.isWinner || isDraw
                    ? "filter brightness-125 drop-shadow-[0_0_8px_rgba(255,215,0,0.7)]"
                    : "filter brightness-75"
                }`}
              />
            </animated.div>
          </div>

          <PlayerDisplay player={player2} />
        </div>

        {/* Navigation buttons */}
        {showButtons && (
          <animated.div style={buttonProps} className="flex gap-4 mt-8">
            <Button
              onClick={onBackToHome}
              className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
              size="lg"
            >
              <Home className="w-5 h-5" />
              Back to Home
            </Button>
            <Button
              onClick={onJoinQueue}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
              size="lg"
            >
              <Swords className="w-5 h-5" />
              Join Queue
            </Button>
          </animated.div>
        )}
      </div>
    </div>
  );
};

export default MatchResultAnimation;