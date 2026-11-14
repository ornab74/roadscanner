"""Illustrative three-qubit RGB simulation; never an accident-risk estimator."""
import numpy as np
import pennylane as qml

device = qml.device('default.qubit', wires=3, shots=None)

@qml.qnode(device)
def rgb_state(rgb):
    for wire in range(3):
        value = rgb[wire]
        qml.RY(np.pi * value, wires=wire)
        qml.RZ(np.pi * (1.0 - value) / 2.0, wires=wire)
    qml.CNOT(wires=[0, 1])
    qml.CNOT(wires=[1, 2])
    qml.CZ(wires=[2, 0])
    qml.RY(np.pi / 5.0, wires=0)
    qml.RX(np.pi / 7.0, wires=2)
    return qml.state()

def entropy_bits(probabilities):
    p = np.asarray(probabilities, dtype=float)
    p = p[p > 0.0]
    return float(-np.sum(p * np.log2(p)))

def inspect_rgb_state(rgb):
    rgb = np.asarray(rgb, dtype=float)
    if rgb.shape != (3,):
        raise ValueError('Expected three RGB inputs.')
    if not np.all(np.isfinite(rgb)):
        raise ValueError('Inputs must be finite.')
    if np.any(rgb < 0.0) or np.any(rgb > 1.0):
        raise ValueError('Inputs must be within [0, 1].')
    state = np.asarray(rgb_state(rgb), dtype=np.complex128)
    probabilities = np.abs(state) ** 2
    probabilities /= probabilities.sum()
    measurement_entropy = entropy_bits(probabilities)
    normalized_entropy = measurement_entropy / 3.0
    amplitudes = state.reshape(2, 2, 2)
    reduced_state = np.tensordot(
        amplitudes, amplitudes.conj(), axes=([1, 2], [1, 2])
    )
    eigenvalues = np.linalg.eigvalsh(reduced_state).real
    eigenvalues = np.clip(eigenvalues, 0.0, 1.0)
    eigenvalues /= eigenvalues.sum()
    subsystem_entropy = entropy_bits(eigenvalues)
    distribution = probabilities.reshape(2, 2, 2)
    channels = np.array([
        np.take(distribution, 1, axis=wire).sum()
        for wire in range(3)
    ])
    display_rgb = np.rint(255.0 * channels).astype(int)
    display_hex = '#' + ''.join(f'{channel:02x}' for channel in display_rgb)
    return {
        'input_rgb': rgb.tolist(),
        'measurement_probabilities': probabilities.tolist(),
        'measurement_entropy_bits': measurement_entropy,
        'normalized_measurement_entropy': normalized_entropy,
        'qubit_0_subsystem_entropy_bits': subsystem_entropy,
        'display_color': display_hex,
        'provenance': 'SIMULATED_RESEARCH_EXAMPLE',
    }

if __name__ == '__main__':
    result = inspect_rgb_state([0.70, 0.30, 0.20])
    assert np.isclose(sum(result['measurement_probabilities']), 1.0)
    assert 0.0 <= result['normalized_measurement_entropy'] <= 1.0
    assert 0.0 <= result['qubit_0_subsystem_entropy_bits'] <= 1.0 + 1e-12
    print(result)
