import { useCallback, useEffect, useRef, useState } from 'react'
import { isUndefined } from 'lodash'
import { useSocket } from '../schema'
import { AsemicData } from '@/lib'

export function useAsemic({
  asemic,
  canvas,
  editable,
  scenesSource,
  setScenesSource
}) {
  const { socket, schema, setSchema } = useSocket()
  useEffect(() => {
    asemic.current?.postMessage({
      params: schema?.params
    })
  }, [schema])

  const useRecording = () => {
    const [isRecording, setIsRecording] = useState(false)
    // const fileInputRef = useRef<HTMLInputElement>(null)
    // const imageInputRef = useRef<HTMLInputElement>(null)
    // const canvasRecorderRef = useRef<Recorder | null>(null) // REMOVE
    const mediaRecorderRef = useRef<MediaRecorder | null>(null) // ADD
    const recordedChunksRef = useRef<BlobPart[]>([])

    const startRecording = async () => {
      try {
        // Setup recording canvas to match main canvas size
        const mainCanvas = canvas.current
        recordingCanvas.current.width = mainCanvas.width
        recordingCanvas.current.height = mainCanvas.height

        // const context = recordingCanvas.current.getContext('bitmaprenderer')! // REMOVE
        // canvasRecorderRef.current = new Recorder(context, { // REMOVE
        //   name: 'asemic-recording', // REMOVE
        //   encoderOptions: { // REMOVE
        //     codec: AVC.getCodec({ profile: 'Main', level: '5.2' }) // REMOVE
        //   }, // REMOVE
        //   rect: [ // REMOVE
        //     0, // REMOVE
        //     0, // REMOVE
        //     recordingCanvas.current.width, // REMOVE
        //     recordingCanvas.current.height // REMOVE
        //   ], // REMOVE
        //   frameRate: 60, // REMOVE
        //   extension: 'mp4', // REMOVE
        //   download: true // REMOVE
        // }) // REMOVE

        // await canvasRecorderRef.current.start() // REMOVE

        // Get MediaStream from canvas
        const stream = recordingCanvas.current.captureStream(60) // ADD

        // Create MediaRecorder
        mediaRecorderRef.current = new MediaRecorder(stream, {
          // ADD
          mimeType: 'video/webm' // ADD
        }) // ADD

        // Reset recorded chunks
        recordedChunksRef.current = [] // ADD

        // Set up data available event
        mediaRecorderRef.current.ondataavailable = (event: BlobEvent) => {
          // ADD
          if (event.data.size > 0) {
            // ADD
            recordedChunksRef.current.push(event.data) // ADD
          } // ADD
        } // ADD

        // Set up stop event
        mediaRecorderRef.current.onstop = () => {
          // ADD
          const blob = new Blob(recordedChunksRef.current, {
            // ADD
            type: 'video/webm' // ADD
          }) // ADD
          saveRecordedVideo(blob) // ADD
        } // ADD

        // Start MediaRecorder
        mediaRecorderRef.current.start() // ADD

        // Start worker recording
        asemic.current!.postMessage({
          startRecording: true
        } as AsemicData)

        setIsRecording(true)
      } catch (error) {
        console.error('Failed to start recording:', error)
        setIsRecording(false)
      }
    }

    const stopRecording = async () => {
      if (!asemic.current) return

      try {
        // Stop worker recording
        asemic.current.postMessage({
          stopRecording: true
        } as AsemicData)

        // Stop canvas recorder
        // if (canvasRecorderRef.current) { // REMOVE
        //   canvasRecorderRef.current.stop() // REMOVE
        //   setIsRecording(false) // REMOVE
        // } // REMOVE

        // Stop MediaRecorder
        if (mediaRecorderRef.current) {
          // ADD
          mediaRecorderRef.current.stop() // ADD
          setIsRecording(false) // ADD
        } // ADD
      } catch (error) {
        console.error('Failed to stop recording:', error)
        setIsRecording(false)
      }
    }

    const stepRecording = async () => {
      // if ( // REMOVE
      //   canvasRecorderRef.current && // REMOVE
      //   canvasRecorderRef.current.status === RecorderStatus.Recording // REMOVE
      // ) { // REMOVE
      //   try { // REMOVE
      //     await canvasRecorderRef.current.step() // REMOVE
      //   } catch (error) { // REMOVE
      //     console.error('Recording step error:', error) // REMOVE
      //   } // REMOVE
      // } // REMOVE
    }

    const saveRecordedVideo = (recordedData: Blob) => {
      try {
        const url = URL.createObjectURL(recordedData)
        const a = document.createElement('a')
        a.href = url
        a.download = `asemic-recording-${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, '-')}.webm` // Modified extension
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setIsRecording(false)
      } catch (error) {
        console.error('Failed to save recording:', error)
        setIsRecording(false)
      }
    }

    const toggleRecording = () => {
      if (isRecording) {
        stopRecording()
      } else {
        startRecording()
      }
    }

    return [
      isRecording,
      toggleRecording,
      // handleFileLoad,
      // fileInputRef,
      saveRecordedVideo,
      setIsRecording,
      stepRecording
      // handleImageLoad,
      // imageInputRef
    ] as const
  }
  const [
    isRecording,
    toggleRecording,
    // handleFileLoad,
    // fileInputRef,
    setIsRecording,
    stepRecording
    // handleImageLoad,
    // imageInputRef
  ] = useRecording()

  const setupAudio = () => {
    const [audio, setAudio] = useState<boolean>(false)
    useEffect(() => {
      if (!socket) return
      if (audio) {
        socket?.emit('sc:on')
      } else {
        socket?.emit('sc:off')
      }
    }, [audio])
    return [audio, setAudio] as const
  }
  const [audio, setAudio] = setupAudio()

  const params = schema?.params ?? {}

  // Helper functions for backwards compatibility
  const setParams = useCallback(
    (newParams: typeof params) => {
      setSchema({ params: newParams })
    },
    [schema, setSchema]
  )

  const [selectedParam, setSelectedParam] = useState(
    undefined as string | undefined
  )

  const [copyNotification, setCopyNotification] = useState('')
  const copyPreset = () => {
    const presetValues = Object.fromEntries(
      Object.entries(params).map(([key, param]) => [
        key,
        param.value.toFixed(2)
      ])
    )
    // Format the preset as 'key1=value1 key2=value2' format
    const formattedPreset = Object.entries(presetValues)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ')

    navigator.clipboard.writeText(formattedPreset)
    setCopyNotification(`Copied preset: ${formattedPreset}`)
    setTimeout(() => setCopyNotification(''), 3000)
  }

  const recordingCanvas = useRef<HTMLCanvasElement>(null!)
}
