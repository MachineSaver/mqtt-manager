/**
 * Custom Cooley-Tukey FFT implementation and Signal Processing Utility for AirVibe
 */

const { fft, ifft } = require('fft-js');

/**
 * Calculates the amplitude spectrum from a real-valued time domain signal.
 * @param {number[]} signal - Time domain signal array (preferably length = power of 2)
 * @returns {number[]} Amplitude spectrum (half the size of the input signal)
 */
function calculateAmplitudeSpectrum(signal) {
    const N = signal.length;
    const windowedSignal = new Array(N);

    // Apply Hanning Window to reduce spectral leakage
    for (let i = 0; i < N; i++) {
        const windowMultiplier = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
        windowedSignal[i] = signal[i] * windowMultiplier;
    }

    // Call fft-js library
    const phasors = fft(windowedSignal);

    // Calculate magnitude (amplitude)
    const amplitudes = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
        const real = phasors[i][0];
        const imag = phasors[i][1];
        const magnitude = Math.sqrt(real * real + imag * imag);
        
        let scaledMag = (magnitude * 2) / N * 2; 
        
        if (i === 0) {
            scaledMag /= 2;
        }
        
        amplitudes[i] = scaledMag;
    }

    return Array.from(amplitudes);
}

/**
 * Calculates the envelope Demodulation spectrum.
 * 1. Raw FFT
 * 2. High pass filter in frequency domain
 * 3. Inverse FFT
 * 4. Rectification (absolute value)
 * 5. Final Amplitude Spectrum
 */
function calculateEnvelopeSpectrum(signal, sampleRateHz) {
    const N = signal.length;
    // Step 1: Raw FFT (No Hanning window initially to avoid distorting the signal)
    const phasors = fft(signal);
    const resolutionHz = sampleRateHz / N;
    
    // Step 2: High Pass Filter (zero out low frequencies)
    // Cutoff at 1000 Hz, or 25% of Nyquist if sample rate is very slow
    let cutoffHz = 1000;
    if (sampleRateHz < 2000) cutoffHz = sampleRateHz / 4;
    const cutoffIdx = Math.floor(cutoffHz / resolutionHz);

    for (let i = 0; i < N; i++) {
        // Zero out anything below cutoff
        // The first N/2 are positive frequencies, second N/2 are negative frequencies
        if (i < cutoffIdx || i > N - cutoffIdx) {
            phasors[i][0] = 0;
            phasors[i][1] = 0;
        }
    }

    // Step 3: Inverse FFT
    const filteredTime = ifft(phasors);

    // Step 4: Rectify and remove DC offset
    const rectified = new Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) {
        rectified[i] = Math.abs(filteredTime[i][0]);
        mean += rectified[i];
    }
    mean /= N;
    for (let i = 0; i < N; i++) {
        rectified[i] -= mean;
    }

    // Step 5: Final Amplitude Spectrum (applies Window and FFT)
    return calculateAmplitudeSpectrum(rectified);
}

/**
 * Main entry point for processing raw AirVibe waveform bytes into Spectrums.
 * Deinterleaves multi-axis data and computes FFTs for all active axes.
 * @param {Buffer} rawBuffer - The raw ByteArray of the waveform
 * @param {number} axisMask - The axis_mask from metadata
 * @param {number} sampleRateHz - The sampling rate of the sensor
 * @param {number} accelRangeG - The G-range setting of the sensor (default 8)
 * @returns {Array} Array of spectrum objects for inserting into the DB
 */
function processWaveformToSpectrums(rawBuffer, axisMask, sampleRateHz, accelRangeG = 8) {
    const isTri = axisMask === 0x07;
    const isAxis1 = (axisMask & 0x01) !== 0;
    const isAxis2 = (axisMask & 0x02) !== 0;
    const isAxis3 = (axisMask & 0x04) !== 0;

    const axis1Raw = [];
    const axis2Raw = [];
    const axis3Raw = [];

    let offset = 0;
    while (offset < rawBuffer.length) {
        if (isTri) {
            if (offset + 6 > rawBuffer.length) break;
            axis1Raw.push(rawBuffer.readInt16LE(offset));
            axis2Raw.push(rawBuffer.readInt16LE(offset + 2));
            axis3Raw.push(rawBuffer.readInt16LE(offset + 4));
            offset += 6;
        } else {
            if (offset + 2 > rawBuffer.length) break;
            const val = rawBuffer.readInt16LE(offset);
            if (isAxis1) axis1Raw.push(val);
            else if (isAxis2) axis2Raw.push(val);
            else if (isAxis3) axis3Raw.push(val);
            offset += 2;
        }
    }

    const results = [];

    const processAxis = (rawArray, axisName) => {
        if (rawArray.length === 0) return;
        
        const numSamples = rawArray.length;
        const N = Math.pow(2, Math.floor(Math.log2(numSamples)));
        
        const lsbPerG = 65536 / (accelRangeG * 2);
        const accelGSolo = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            accelGSolo[i] = (rawArray[i] / lsbPerG) * 9806.65; // Convert G to mm/s^2
        }

        const accelSpectrum = calculateAmplitudeSpectrum(accelGSolo);
        const velocitySpectrum = new Float32Array(accelSpectrum.length);
        const envelopeSpectrum = calculateEnvelopeSpectrum(accelGSolo, sampleRateHz);
        const resolutionHz = sampleRateHz / N;
        
        let accelPeakFreq = 0;
        let accelPeakMag = -Infinity;
        let velPeakFreq = 0;
        let velPeakMag = -Infinity;
        let envPeakFreq = 0;
        let envPeakMag = -Infinity;

        for (let i = 0; i < accelSpectrum.length; i++) {
            const freqHz = i * resolutionHz;
            
            if (i === 0) {
                velocitySpectrum[i] = 0;
            } else {
                velocitySpectrum[i] = accelSpectrum[i] / (2 * Math.PI * freqHz);
            }
            
            // Exclude DC offset at 0 Hz from genuine peak detection
            if (i > 0) {
                if (accelSpectrum[i] > accelPeakMag) {
                    accelPeakMag = accelSpectrum[i];
                    accelPeakFreq = freqHz;
                }
                if (velocitySpectrum[i] > velPeakMag) {
                    velPeakMag = velocitySpectrum[i];
                    velPeakFreq = freqHz;
                }
                if (envelopeSpectrum[i] > envPeakMag) {
                    envPeakMag = envelopeSpectrum[i];
                    envPeakFreq = freqHz;
                }
            }
        }

        results.push({
            axis: axisName,
            resolutionHz,
            maxFrequencyHz: sampleRateHz / 2,
            accelerationBytes: Buffer.from(new Float32Array(accelSpectrum).buffer),
            velocityBytes: Buffer.from(velocitySpectrum.buffer),
            envelopeBytes: Buffer.from(new Float32Array(envelopeSpectrum).buffer),
            peaks: {
                accel: { hz: Number(accelPeakFreq.toFixed(1)), mag: Number(accelPeakMag.toFixed(3)) },
                velocity: { hz: Number(velPeakFreq.toFixed(1)), mag: Number(velPeakMag.toFixed(3)) },
                envelope: { hz: Number(envPeakFreq.toFixed(1)), mag: Number(envPeakMag.toFixed(3)) }
            }
        });
    };

    if (isAxis1) processAxis(axis1Raw, 'axis_1');
    if (isAxis2) processAxis(axis2Raw, 'axis_2');
    if (isAxis3) processAxis(axis3Raw, 'axis_3');

    return results;
}

module.exports = {
    processWaveformToSpectrums
};
