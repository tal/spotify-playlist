#!/usr/bin/env node
import { Dynamo } from '../db/dynamo'
import { Spotify } from '../spotify'
import SpotifyWebApi from 'spotify-web-api-node'

// Configuration
const PLAYLIST_ID = '4BGqDwiJAJnrqKwaoWRjuo'

interface TrackAnalysis {
  id: string
  name: string
  artist: string
  artists: string[]
  album: string
  releaseDate: string
  releaseYear: number
  duration_ms: number
  popularity: number
  explicit: boolean
  preview_url: string | null
}

interface PlaylistAnalysis {
  name: string
  totalTracks: number
  totalDuration: number
  avgPopularity: number
  topArtists: { artist: string; count: number }[]
  releaseYearDistribution: { year: number; count: number }[]
  explicitCount: number
  avgTrackDuration: number
  oldestTrack: { track: string; artist: string; year: number }
  newestTrack: { track: string; artist: string; year: number }
}

async function analyzePlaylist(playlistId: string): Promise<void> {
  try {
    // Initialize Dynamo and Spotify client
    console.log('🔧 Initializing Spotify client...')
    const dynamo = await Dynamo.getForUser('tal') // Using your user ID from the codebase
    const spotify = await Spotify.get(dynamo)
    
    // Get playlist details
    console.log(`📋 Fetching playlist ${playlistId}...`)
    const playlistResponse = await spotify.client.getPlaylist(playlistId)
    const playlist = playlistResponse.body
    
    console.log(`\n🎵 Playlist: ${playlist.name}`)
    console.log(`👤 Owner: ${playlist.owner.display_name}`)
    console.log(`📝 Description: ${playlist.description || 'No description'}`)
    console.log(`🔢 Total tracks: ${playlist.tracks.total}`)
    
    // Fetch all tracks
    console.log('\n📥 Fetching all tracks...')
    let tracks: TrackAnalysis[] = []
    let offset = 0
    const limit = 100
    
    while (offset < playlist.tracks.total) {
      const response = await spotify.client.getPlaylistTracks(playlistId, {
        limit,
        offset,
      })
      
      const batch = response.body.items
        .filter(item => item.track && item.track.type === 'track')
        .map(item => {
          const track = item.track as any
          return {
            id: track.id,
            name: track.name,
            artist: track.artists[0].name,
            artists: track.artists.map((a: any) => a.name),
            album: track.album.name,
            releaseDate: track.album.release_date,
            releaseYear: parseInt(track.album.release_date.split('-')[0]),
            duration_ms: track.duration_ms,
            popularity: track.popularity,
            explicit: track.explicit,
            preview_url: track.preview_url,
          }
        })
      
      tracks = tracks.concat(batch)
      offset += limit
      console.log(`  Progress: ${tracks.length}/${playlist.tracks.total} tracks`)
    }
    
    // Analyze the data
    console.log('\n📊 Analyzing playlist data...')
    
    // Calculate statistics
    const totalDuration = tracks.reduce((sum, track) => sum + track.duration_ms, 0)
    const avgPopularity = tracks.reduce((sum, track) => sum + track.popularity, 0) / tracks.length
    const explicitCount = tracks.filter(track => track.explicit).length
    const avgTrackDuration = totalDuration / tracks.length
    
    // Artist frequency
    const artistCount = new Map<string, number>()
    tracks.forEach(track => {
      track.artists.forEach(artist => {
        artistCount.set(artist, (artistCount.get(artist) || 0) + 1)
      })
    })
    const topArtists = Array.from(artistCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([artist, count]) => ({ artist, count }))
    
    // Release year distribution
    const yearCount = new Map<number, number>()
    tracks.forEach(track => {
      if (track.releaseYear) {
        yearCount.set(track.releaseYear, (yearCount.get(track.releaseYear) || 0) + 1)
      }
    })
    const releaseYearDistribution = Array.from(yearCount.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, count]) => ({ year, count }))
    
    // Find oldest and newest tracks
    const sortedByYear = tracks
      .filter(track => track.releaseYear)
      .sort((a, b) => a.releaseYear - b.releaseYear)
    
    const oldestTrack = sortedByYear[0]
    const newestTrack = sortedByYear[sortedByYear.length - 1]
    
    // Display results
    console.log('\n' + '='.repeat(60))
    console.log('📈 PLAYLIST ANALYSIS RESULTS')
    console.log('='.repeat(60))
    
    console.log('\n📊 GENERAL STATISTICS:')
    console.log(`  • Total tracks: ${tracks.length}`)
    console.log(`  • Total duration: ${formatDuration(totalDuration)}`)
    console.log(`  • Average track duration: ${formatDuration(avgTrackDuration)}`)
    console.log(`  • Average popularity: ${avgPopularity.toFixed(1)}/100`)
    console.log(`  • Explicit tracks: ${explicitCount} (${(explicitCount / tracks.length * 100).toFixed(1)}%)`)
    
    console.log('\n🎤 TOP 15 ARTISTS (by track count):')
    topArtists.forEach(({ artist, count }) => {
      const percentage = (count / tracks.length * 100).toFixed(1)
      console.log(`  ${count.toString().padStart(3)} tracks (${percentage.padStart(5)}%) - ${artist}`)
    })
    
    console.log('\n📅 RELEASE YEAR DISTRIBUTION:')
    // Group by decades for better visualization
    const decades = new Map<string, number>()
    releaseYearDistribution.forEach(({ year, count }) => {
      const decade = `${Math.floor(year / 10) * 10}s`
      decades.set(decade, (decades.get(decade) || 0) + count)
    })
    
    Array.from(decades.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([decade, count]) => {
        const percentage = (count / tracks.length * 100).toFixed(1)
        const bar = '█'.repeat(Math.round(count / tracks.length * 50))
        console.log(`  ${decade}: ${bar} ${count} tracks (${percentage}%)`)
      })
    
    console.log('\n🕰️ TRACK AGE RANGE:')
    console.log(`  • Oldest: "${oldestTrack.name}" by ${oldestTrack.artist} (${oldestTrack.releaseYear})`)
    console.log(`  • Newest: "${newestTrack.name}" by ${newestTrack.artist} (${newestTrack.releaseYear})`)
    
    // Additional insights
    console.log('\n💡 INTERESTING PATTERNS:')
    
    // Check for compilation albums
    const albumCount = new Map<string, number>()
    tracks.forEach(track => {
      albumCount.set(track.album, (albumCount.get(track.album) || 0) + 1)
    })
    const multiTrackAlbums = Array.from(albumCount.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    
    if (multiTrackAlbums.length > 0) {
      console.log('\n  📀 Albums with multiple tracks:')
      multiTrackAlbums.forEach(([album, count]) => {
        console.log(`    • ${album}: ${count} tracks`)
      })
    }
    
    // Popularity insights
    const highPopTracks = tracks.filter(t => t.popularity >= 70).length
    const lowPopTracks = tracks.filter(t => t.popularity < 30).length
    console.log(`\n  📊 Popularity distribution:`)
    console.log(`    • High popularity (≥70): ${highPopTracks} tracks (${(highPopTracks / tracks.length * 100).toFixed(1)}%)`)
    console.log(`    • Low popularity (<30): ${lowPopTracks} tracks (${(lowPopTracks / tracks.length * 100).toFixed(1)}%)`)
    
    // Export detailed track list
    const exportPath = `/tmp/playlist_${playlistId}_analysis.json`
    const exportData = {
      playlist: {
        id: playlist.id,
        name: playlist.name,
        owner: playlist.owner.display_name,
        description: playlist.description,
        analyzedAt: new Date().toISOString(),
      },
      statistics: {
        totalTracks: tracks.length,
        totalDuration,
        avgPopularity,
        explicitCount,
        avgTrackDuration,
      },
      topArtists,
      releaseYearDistribution,
      tracks: tracks.sort((a, b) => b.popularity - a.popularity), // Sort by popularity
    }
    
    await require('fs').promises.writeFile(exportPath, JSON.stringify(exportData, null, 2))
    console.log(`\n💾 Detailed analysis exported to: ${exportPath}`)
    
  } catch (error) {
    console.error('❌ Error analyzing playlist:', error)
    throw error
  }
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  } else {
    return `${seconds}s`
  }
}

// Run the analysis
if (require.main === module) {
  console.log('🚀 Starting playlist analysis...')
  analyzePlaylist(PLAYLIST_ID)
    .then(() => {
      console.log('\n✅ Analysis complete!')
      process.exit(0)
    })
    .catch(error => {
      console.error('\n❌ Analysis failed:', error)
      process.exit(1)
    })
}

export { analyzePlaylist }