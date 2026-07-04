// server/src/services/ai-clipping-engine.js
/**
 * ZipZop AI - Intelligent Video Clipping Engine
 * 
 * Analyzes gaming videos to identify:
 * - High-action moments (sound spikes, gameplay peaks)
 * - Dialogue segments (speech detection)
 * - Boring segments (silence, low activity)
 * - Funny moments (unusual audio patterns)
 * 
 * Output: JSON with recommended clips + timestamps
 */

import ffmpeg from 'fluent-ffmpeg';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import Whisper from 'openai';

const execAsync = promisify(exec);

// ========== CONFIGURATION ==========

const TEMP_DIR = './data/temp';
const OUTPUT_DIR = './data/outputs';

// Action detection thresholds
const THRESHOLDS = {
  ACTION_PEAK: -15, // dB (loud = action)
  DIALOGUE_THRESHOLD: -25, // dB (speech detection)
  SILENCE_THRESHOLD: -40, // dB (boring segments)
  MINIMUM_CLIP_LENGTH: 3, // seconds
  MAXIMUM_CLIP_LENGTH: 60, // seconds
  ACTION_WINDOW: 5 // seconds (look for sustained action)
};

// ========== AUDIO EXTRACTION ==========

/**
 * Extract audio from video file
 * Converts to WAV format suitable for analysis
 */
async function extractAudio(videoPath, jobId) {
  console.log('🎵 Extracting audio from video...');

  const audioPath = path.join(TEMP_DIR, `${jobId}_audio.wav`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('pcm_s16le') // WAV PCM format
      .audioFrequency(16000) // 16kHz (optimal for speech recognition)
      .output(audioPath)
      .on('end', () => {
        console.log('✅ Audio extracted');
        resolve(audioPath);
      })
      .on('error', reject)
      .run();
  });
}

// ========== AUDIO ANALYSIS - VOLUME DETECTION ==========

/**
 * Analyze audio waveform to detect volume peaks (action moments)
 * Uses FFmpeg to generate volume data
 */
async function analyzeAudioVolume(audioPath, jobId) {
  console.log('📊 Analyzing audio volume levels...');

  // Use ffmpeg's volumedetect filter to get RMS levels
  const metadataPath = path.join(TEMP_DIR, `${jobId}_volume.json`);

  return new Promise((resolve, reject) => {
    ffmpeg(audioPath)
      .audioFilter(`volumedetect=print_summary=1:nb_samples=2400`) // Every 2400 samples ~0.15s
      .noAudio()
      .output('-')
      .on('stderr', (stderrLine) => {
        // FFmpeg outputs volume data to stderr
        if (stderrLine.includes('[volumedetect')) {
          console.log(`📊 Volume Data: ${stderrLine}`);
        }
      })
      .on('end', async () => {
        console.log('✅ Volume analysis complete');

        // Parse ffmpeg output and generate timeline
        const volumeTimeline = await generateVolumeTimeline(audioPath);
        resolve(volumeTimeline);
      })
      .on('error', reject)
      .run();
  });
}

/**
 * Generate volume timeline using ffmpeg's ebur128 filter
 */
async function generateVolumeTimeline(audioPath) {
  console.log('📈 Generating volume timeline...');

  const cmd = `ffmpeg -i "${audioPath}" -af "ebur128=metadata=1" -f null - 2>&1 | grep -oP 'M: -?\\d+\\.\\d+'`;

  try {
    const { stdout } = await execAsync(cmd);
    const levels = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => parseFloat(line.match(/-?\d+\.\d+/)[0]));

    console.log(`✅ Extracted ${levels.length} volume samples`);

    return levels;
  } catch (err) {
    console.warn('⚠️ Volume timeline generation failed, using fallback');
    return [];
  }
}

// ========== SPEECH-TO-TEXT & DIALOGUE DETECTION ==========

/**
 * Use Whisper to transcribe audio and detect dialogue segments
 * Also identifies emotion/tone from speech patterns
 */
async function analyzeDialogue(audioPath, jobId) {
  console.log('🗣️ Analyzing dialogue with Whisper...');

  try {
    const whisper = new Whisper({
      apiKey: process.env.OPENAI_API_KEY
    });

    const audioStream = await fs.readFile(audioPath);

    // Transcribe with timestamp information
    const response = await whisper.audio.transcriptions.create({
      file: new File([audioStream], 'audio.wav', { type: 'audio/wav' }),
      model: 'whisper-1',
      language: 'en',
      response_format: 'verbose_json', // Includes word-level timestamps
      timestamp_granularities: ['segment'] // Get segment timestamps
    });

    console.log(`✅ Transcribed: ${response.text.substring(0, 100)}...`);

    // Extract dialogue segments with confidence
    const dialogueSegments = response.segments.map(segment => ({
      start: segment.start,
      end: segment.end,
      text: segment.text,
      confidence: segment.confidence || 0.9,
      type: classifyDialogue(segment.text)
    }));

    return dialogueSegments;

  } catch (err) {
    console.warn(`⚠️ Dialogue analysis failed: ${err.message}`);
    return [];
  }
}

/**
 * Classify dialogue type (normal, excited, shouting, etc.)
 */
function classifyDialogue(text) {
  const upperCase = (text.match(/[A-Z]/g) || []).length;
  const exclamation = (text.match(/!/g) || []).length;
  const allCaps = upperCase > text.length * 0.5;

  if (allCaps || exclamation > 2) return 'EXCITED';
  if (text.includes('?')) return 'QUESTION';
  if (text.length < 5) return 'SHORT';
  
  return 'NORMAL';
}

// ========== GAMEPLAY ACTION DETECTION ==========

/**
 * Detect gaming action moments using audio characteristics:
 * - Music intensity changes
 * - Sudden loud sounds (gunfire, explosions)
 * - Background noise patterns
 */
async function detectGameplayAction(volumeTimeline, audioPath) {
  console.log('🎮 Detecting gameplay action moments...');

  if (volumeTimeline.length === 0) {
    console.warn('⚠️ No volume timeline available');
    return [];
  }

  const actionMoments = [];
  const windowSize = Math.ceil(volumeTimeline.length * 0.02); // 2% of audio
  const threshold = THRESHOLDS.ACTION_PEAK;

  for (let i = 0; i < volumeTimeline.length - windowSize; i++) {
    const window = volumeTimeline.slice(i, i + windowSize);
    const average = window.reduce((a, b) => a + b) / window.length;
    const maxLevel = Math.max(...window);

    // Action peak: sustained loud sounds or sudden spikes
    if (average > threshold || maxLevel - average > 5) {
      const startTime = (i * THRESHOLDS.ACTION_WINDOW) / 1000;
      const endTime = ((i + windowSize) * THRESHOLDS.ACTION_WINDOW) / 1000;

      actionMoments.push({
        start: startTime,
        end: endTime,
        intensity: maxLevel,
        type: 'ACTION_PEAK',
        confidence: Math.min(100, (maxLevel + 40) * 2.5) // Convert dB to confidence
      });
    }
  }

  // Merge nearby action moments
  const mergedMoments = mergeNearbySegments(actionMoments, 2);

  console.log(`✅ Found ${mergedMoments.length} action moments`);
  return mergedMoments;
}

// ========== SEGMENT MERGING ==========

/**
 * Merge nearby segments to avoid fragmentation
 */
function mergeNearbySegments(segments, mergeThreshold = 2) {
  if (segments.length === 0) return [];

  const merged = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const last = merged[merged.length - 1];

    // If segments are close, merge them
    if (current.start - last.end < mergeThreshold) {
      last.end = current.end;
      last.intensity = Math.max(last.intensity, current.intensity);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ========== SILENCE & BORING DETECTION ==========

/**
 * Identify boring segments (silence, low activity)
 */
function detectBoringSegments(volumeTimeline) {
  console.log('😴 Detecting boring segments...');

  const boringSegments = [];
  const threshold = THRESHOLDS.SILENCE_THRESHOLD;
  const minDuration = THRESHOLDS.MINIMUM_CLIP_LENGTH;

  let silenceStart = null;

  for (let i = 0; i < volumeTimeline.length; i++) {
    const level = volumeTimeline[i];
    const timeSeconds = (i * THRESHOLDS.ACTION_WINDOW) / 1000;

    if (level < threshold) {
      if (silenceStart === null) {
        silenceStart = timeSeconds;
      }
    } else {
      if (silenceStart !== null) {
        const duration = timeSeconds - silenceStart;
        if (duration >= minDuration) {
          boringSegments.push({
            start: silenceStart,
            end: timeSeconds,
            duration,
            type: 'SILENCE',
            reason: 'Low audio activity (silence or pause)'
          });
        }
        silenceStart = null;
      }
    }
  }

  console.log(`✅ Found ${boringSegments.length} boring segments`);
  return boringSegments;
}

// ========== CLIP RECOMMENDATION ENGINE ==========

/**
 * Generate recommended clips based on analysis
 * Combines action, dialogue, and excludes boring segments
 */
async function generateClipRecommendations(
  videoPath,
  actionMoments,
  dialogueSegments,
  boringSegments
) {
  console.log('🎬 Generating clip recommendations...');

  // Get video duration
  const duration = await getVideoDuration(videoPath);

  const recommendations = [];
  const processedTimeRanges = new Set();

  // Priority 1: Combine action + dialogue for maximum engagement
  for (const action of actionMoments) {
    for (const dialogue of dialogueSegments) {
      if (action.start <= dialogue.end && action.end >= dialogue.start) {
        const start = Math.max(action.start, dialogue.start);
        const end = Math.min(action.end, dialogue.end);
        const duration = end - start;

        if (
          duration >= THRESHOLDS.MINIMUM_CLIP_LENGTH &&
          duration <= THRESHOLDS.MAXIMUM_CLIP_LENGTH
        ) {
          const rangeKey = `${start}-${end}`;

          if (!processedTimeRanges.has(rangeKey)) {
            recommendations.push({
              start: Math.round(start * 100) / 100,
              end: Math.round(end * 100) / 100,
              duration: Math.round(duration * 100) / 100,
              type: 'ACTION_WITH_DIALOGUE',
              reason: `${dialogue.type === 'EXCITED' ? '🔥 Exciting dialogue' : '💬 Dialogue'} during action peak`,
              score: (action.confidence + (dialogue.confidence * 100)) / 2,
              tags: ['action', 'dialogue', dialogue.type.toLowerCase()]
            });

            processedTimeRanges.add(rangeKey);
          }
        }
      }
    }
  }

  // Priority 2: Pure action moments
  for (const action of actionMoments) {
    if (!isTimeRangeProcessed(action, processedTimeRanges)) {
      const duration = action.end - action.start;

      if (
        duration >= THRESHOLDS.MINIMUM_CLIP_LENGTH &&
        duration <= THRESHOLDS.MAXIMUM_CLIP_LENGTH
      ) {
        recommendations.push({
          start: Math.round(action.start * 100) / 100,
          end: Math.round(action.end * 100) / 100,
          duration: Math.round(duration * 100) / 100,
          type: 'ACTION_PEAK',
          reason: '⚡ High-action moment (gameplay peak)',
          score: action.confidence,
          tags: ['action', 'gameplay']
        });

        processedTimeRanges.add(`${action.start}-${action.end}`);
      }
    }
  }

  // Priority 3: Standalone dialogue (funny, excited, etc.)
  for (const dialogue of dialogueSegments) {
    if (dialogue.type === 'EXCITED' || dialogue.type === 'QUESTION') {
      if (!isTimeRangeProcessed(dialogue, processedTimeRanges)) {
        const duration = dialogue.end - dialogue.start;

        if (
          duration >= THRESHOLDS.MINIMUM_CLIP_LENGTH &&
          duration <= THRESHOLDS.MAXIMUM_CLIP_LENGTH
        ) {
          recommendations.push({
            start: Math.round(dialogue.start * 100) / 100,
            end: Math.round(dialogue.end * 100) / 100,
            duration: Math.round(duration * 100) / 100,
            type: 'DIALOGUE_MOMENT',
            reason: `😄 ${dialogue.type === 'EXCITED' ? 'Excited dialogue' : 'Interesting dialogue'}`,
            score: dialogue.confidence * 100,
            tags: ['dialogue', dialogue.type.toLowerCase()]
          });

          processedTimeRanges.add(`${dialogue.start}-${dialogue.end}`);
        }
      }
    }
  }

  // Sort by score (best clips first)
  recommendations.sort((a, b) => b.score - a.score);

  console.log(`✅ Generated ${recommendations.length} clip recommendations`);

  return {
    totalDuration: duration,
    clipsFound: recommendations.length,
    recommendations,
    summary: {
      actionPeaks: recommendations.filter(r => r.type === 'ACTION_PEAK').length,
      dialogueMoments: recommendations.filter(r => r.type === 'DIALOGUE_MOMENT').length,
      combinedClips: recommendations.filter(r => r.type === 'ACTION_WITH_DIALOGUE').length,
      boringSegmentsSkipped: boringSegments.length,
      totalScreenTime: recommendations.reduce((sum, r) => sum + r.duration, 0)
    }
  };
}

/**
 * Check if time range was already processed
 */
function isTimeRangeProcessed(segment, processedRanges) {
  for (const range of processedRanges) {
    const [rangeStart, rangeEnd] = range.split('-').map(Number);
    if (segment.start >= rangeStart && segment.end <= rangeEnd) {
      return true;
    }
  }
  return false;
}

// ========== VIDEO DURATION ==========

/**
 * Get video duration
 */
async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath).ffprobe((err, metadata) => {
      if (err) reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// ========== MAIN CLIPPING ENGINE ==========

/**
 * Main function: Analyze video and generate clip recommendations
 */
export async function analyzeVideoForClips(videoPath, jobId) {
  const startTime = Date.now();

  try {
    console.log(`\n🎬 ZipZop AI: Analyzing video for clips (Job: ${jobId})`);
    console.log('═'.repeat(60));

    // Step 1: Extract audio
    console.log('\n[1/5] Audio Extraction');
    const audioPath = await extractAudio(videoPath, jobId);

    // Step 2: Analyze volume
    console.log('\n[2/5] Volume Analysis');
    const volumeTimeline = await analyzeAudioVolume(audioPath, jobId);

    // Step 3: Dialogue detection
    console.log('\n[3/5] Dialogue & Speech Detection');
    const dialogueSegments = await analyzeDialogue(audioPath, jobId);

    // Step 4: Action detection
    console.log('\n[4/5] Gameplay Action Detection');
    const actionMoments = await detectGameplayAction(volumeTimeline, audioPath);

    // Step 5: Boring segment detection
    console.log('\n[5/5] Boring Segment Detection');
    const boringSegments = detectBoringSegments(volumeTimeline);

    // Generate recommendations
    console.log('\n🎯 Generating Clip Recommendations');
    const result = await generateClipRecommendations(
      videoPath,
      actionMoments,
      dialogueSegments,
      boringSegments
    );

    const processingTime = Date.now() - startTime;

    // Final output
    const output = {
      jobId,
      status: 'completed',
      videoDuration: result.totalDuration,
      processingTimeMs: processingTime,
      processingTimeSec: (processingTime / 1000).toFixed(2),
      analysisData: {
        totalClipsGenerated: result.clipsFound,
        actionPeaks: actionMoments.length,
        dialogueSegments: dialogueSegments.length,
        boringSegments: boringSegments.length
      },
      recommendations: result.recommendations,
      summary: result.summary,
      metadata: {
        game: 'Game-Agnostic (GTA, PUBG, Valorant, etc.)',
        format: 'Auto-Detected',
        analysisDate: new Date().toISOString()
      }
    };

    console.log('═'.repeat(60));
    console.log(`✅ Analysis Complete`);
    console.log(`   Total Time: ${output.processingTimeSec}s`);
    console.log(`   Clips Found: ${result.clipsFound}`);
    console.log(`   Screen Time: ${result.summary.totalScreenTime.toFixed(2)}s`);
    console.log(`   Boring Segments Skipped: ${boringSegments.length}`);
    console.log('═'.repeat(60) + '\n');

    // Cleanup
    await fs.unlink(audioPath).catch(() => {});

    return output;

  } catch (err) {
    console.error(`\n❌ Analysis Error: ${err.message}`);

    return {
      jobId,
      status: 'failed',
      error: err.message,
      timestamp: new Date().toISOString()
    };
  }
}

// ========== BATCH ANALYSIS ==========

/**
 * Analyze multiple videos
 */
export async function analyzeBatchVideos(videoList) {
  console.log(`\n📦 Analyzing ${videoList.length} videos...`);

  const results = [];

  for (const video of videoList) {
    const jobId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const result = await analyzeVideoForClips(video, jobId);
    results.push(result);
  }

  return results;
}

export default {
  analyzeVideoForClips,
  analyzeBatchVideos,
  detectGameplayAction,
  analyzeDialogue,
  detectBoringSegments
};
