import React, { useEffect, useRef } from "react";
import { useSpring, animated, config } from "react-spring";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { getAvatarUrl } from "@/lib/utils";
// Image import removed - using regular img tags instead

interface PlayerInfo {
  name: string;
  username: string;
  avatar: string | null;
}

interface MatchupAnimationProps {
  player1: PlayerInfo;
  player2: PlayerInfo;
  onAnimationComplete: () => void;
}

const MatchupAnimation: React.FC<MatchupAnimationProps> = ({
  player1,
  player2,
  onAnimationComplete,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    // Play sound only once
    if (!hasPlayedRef.current) {
      audioRef.current = new Audio("/sword-clash.mp3");
      audioRef.current
        .play()
        .catch((error) => console.warn("Error playing sound:", error));
      hasPlayedRef.current = true;
    }

    const timer = setTimeout(onAnimationComplete, 2000);
    
    return () => {
      clearTimeout(timer);
      // Stop audio if component unmounts
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    };
  }, [onAnimationComplete]);

  const [leftSwordProps, setLeftSword] = useSpring(() => ({
    from: { transform: "translateX(-100%) rotate(45deg)" },
    to: { transform: "translateX(-20%) rotate(45deg)" },
    config: { ...config.wobbly, duration: 500 },
  }));

  const [rightSwordProps, setRightSword] = useSpring(() => ({
    from: { transform: "translateX(100%) rotate(-45deg)" },
    to: { transform: "translateX(20%) rotate(-45deg)" },
    config: { ...config.wobbly, duration: 500 },
  }));

  // Helper function to render profile picture
const renderProfilePicture = (avatar: string | null, size: string = "w-24 h-24") => {
    const avatarUrl = getAvatarUrl(avatar);
    return (
      <Avatar className={size}>
      <AvatarImage
        src={avatarUrl || "/placeholder_avatar.png"}
        alt="Profile"
      />
      <AvatarFallback className="bg-gray-200">
        <img
          src="/placeholder_avatar.png"
          alt="Placeholder avatar"
          className="w-full h-full object-cover"
        />
      </AvatarFallback>
      </Avatar>
    );
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md"></div>
      <div className="relative flex items-center justify-center gap-12 z-10">
        {/* Player 1 */}
        <div className="flex flex-col items-center">
          {renderProfilePicture(player1.avatar)}
          <span className="mt-2 text-slate-200 font-bold text-lg">
            {player1.name}
          </span>
          <span className="text-slate-400 text-sm">@{player1.username}</span>
        </div>

        {/* Swords in the middle */}
        <div className="relative w-48 h-48 flex items-center justify-center">
          <animated.div
            style={leftSwordProps}
            className="w-24 h-48 absolute left-1/2 -ml-12"
          >
            <img
              src="/sword-left.svg"
              alt="Left sword"
              width={96}
              height={192}
              className="w-full h-full"
            />
          </animated.div>
          <animated.div
            style={rightSwordProps}
            className="w-24 h-48 absolute right-1/2 -mr-12"
          >
            <img
              src="/sword-right.svg"
              alt="Right sword"
              width={96}
              height={192}
              className="w-full h-full"
            />
          </animated.div>
        </div>

        {/* Player 2 */}
        <div className="flex flex-col items-center">
          {renderProfilePicture(player2.avatar)}
          <span className="mt-2 text-slate-200 font-bold text-lg">
            {player2.name}
          </span>
          <span className="text-slate-400 text-sm">@{player2.username}</span>
        </div>
      </div>
    </div>
  );
};

export default MatchupAnimation;