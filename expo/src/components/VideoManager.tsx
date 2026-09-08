import React, { useEffect, useRef } from 'react';
import { Video } from 'expo-av';
import { ScrollView, View } from 'react-native';

interface VideoManagerProps {
  videos: { uri: string; key: string }[];
}

const VideoManager: React.FC<VideoManagerProps> = ({ videos }) => {
  const videoRefs = useRef<React.RefObject<Video>[]>([]);

  useEffect(() => {
    videoRefs.current = videoRefs.current.slice(0, videos.length);
  }, [videos]);

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset } = event.nativeEvent;
    const visibleIndex = Math.floor(
      contentOffset.y / layoutMeasurement.height
    );

    videoRefs.current.forEach((videoRef, index) => {
      if (!videoRef.current) return;
      if (index === visibleIndex) {
        videoRef.current.playAsync();
      } else {
        videoRef.current.pauseAsync();
      }
    });
  };

  return (
    <ScrollView onScroll={handleScroll} scrollEventThrottle={16}>
      {videos.map((video, index) => (
        <View key={video.key} style={{ height: 300 }}>
          <Video
            ref={(ref) => (videoRefs.current[index] = ref)}
            source={{ uri: video.uri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
            isLooping
            shouldPlay={false}
          />
        </View>
      ))}
    </ScrollView>
  );
};

export default VideoManager;
