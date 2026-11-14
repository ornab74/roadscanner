# A clearer view before the next decision

A wet bend. An exposed bridge. An unfamiliar apartment entrance. A narrow junction approached by an articulated truck.

Each presents a different problem. Understanding those differences is central to what we are building at QRoadScan.

Our long-term goal is to help prevent transport accidents by giving people better context before a difficult decision: what is known, what may deserve attention, and what still needs checking.

That ambition begins with everyday journeys. Over time, we want to explore its application to cars, motorcycles, commercial trucks, aircraft, helicopters, boats, and eventually spacecraft operating across an interglobal—and ultimately interplanetary—transport network.

This is a research and engineering roadmap. Demonstrating that a system actually reduces accidents will require validation, operational expertise, carefully measured outcomes, and sustained work.

The mission gives us a direction. Evidence must determine our progress.

# Where QRoadScan stands today

QRoadScan currently brings several capabilities into one workspace:

- AI-assisted route proposals and route comparisons.
- Colored, section-level caution ribbons with explanations.
- Weather context and RainViewer precipitation imagery.
- Vehicle profiles and a private garage.
- Fullscreen route review, GPS progress, and optional generated voice cues.
- Saved assessments and developer API access.
- A separate aircraft briefing workspace using available weather, traffic snapshots, and fuel scenarios.

These capabilities help users explore a journey and its uncertainties. Route geometry, road access, legal turns, vehicle restrictions, and current conditions still require verification.

The aircraft workspace provides advisory briefing context. Its weather and traffic sources have coverage, age, and completeness limits.

A major part of our work is making those boundaries visible while improving the usefulness of the information inside them.

# The street section is a useful starting point

A single score for an entire journey hides detail.

A route may include a straightforward stretch, an awkward junction, an exposed crossing, and a confusing final approach. Averaging those into one number can conceal the section that deserves the most attention.

We want the route itself to become an explanation.

Each section should eventually carry a structured account of:

- The relevant observations and their sources.
- The time those observations describe.
- The vehicle characteristics considered.
- The factors contributing to modeled caution.
- The evidence quality and unresolved questions.
- The reason its assessment differs from neighboring sections.

The ribbon becomes an entry point into that account. Clicking a section should make its reasoning easier to inspect.

A useful assessment might explain that a junction combines complex geometry with limited visibility evidence, or that a weather estimate covers a broad area while local road-surface conditions remain unknown.

Specific explanations give users something concrete to investigate.

# Different vehicles require different reasoning

A vehicle profile should influence the questions a system asks.

## Cars

For cars, we want to improve the treatment of junction complexity, visibility, weather exposure, maneuver burden, and destination access.

Efficiency also matters. A proposal with fewer difficult maneuvers may be attractive even when its estimated travel time is slightly longer. Fuel estimates need their assumptions displayed, especially when traffic, elevation, or driving behavior is uncertain.

## Motorcycles

Motorcycles introduce a different set of concerns.

Crosswinds, exposed bridges, temperature, precipitation, and evidenced surface transitions may deserve particular attention. Gravel, standing water, paint, and metal surfaces can matter substantially when their presence is actually supported by the available information.

A sophisticated model should explain what it can establish about those factors and identify the observations it lacks.

## Trucks and 18-wheelers

Commercial vehicles require reasoning about dimensions, mass, articulation, access restrictions, loading conditions, and maneuver geometry.

Our direction includes more detailed turn review: the approach, the junction, the exit, and the space an articulated vehicle may need through the maneuver.

A useful truck assessment must distinguish between a geometry-based concern and a verified restriction. Missing clearance or access data should remain visible as missing data.

The longer-term objective is a structured review of each consequential section, with the vehicle’s relevant characteristics attached to the explanation.

## Aircraft and helicopters

Aviation adds altitude, performance, weather evolution, winds, fuel planning, airport conditions, and traffic uncertainty.

Helicopters also introduce questions involving landing sites, obstacles, hover performance, local terrain effects, and operating conditions that differ from fixed-wing flight.

Our present aircraft tools provide a place to review available information. Future work needs stronger data-quality controls, source integration, performance modeling, and collaboration with qualified aviation specialists.

Any progression toward operational aviation capability would require its own assurance and validation program.

## Boats and maritime travel

Maritime work is a future research direction.

We want to investigate how weather, waves, currents, tides, visibility, vessel characteristics, traffic information, and coastal geometry could contribute to an explainable passage review.

Navigation channels, depth, draft, hazards, and restrictions demand authoritative, current information. A plausible-looking map or fluent explanation cannot establish those facts on its own.

The same design principle applies: show the basis for an assessment, alongside its limits.

# An RGB approach to representing uncertainty

Color can help people recognize patterns quickly. It also carries a responsibility: the meaning of a color must remain clear.

Our experimental chromographic direction explores how several normalized inputs might influence a visual state.

For a research example, consider three channels:

- **R:** a normalized environmental exposure feature.
- **G:** a normalized geometry or maneuver-complexity feature.
- **B:** a normalized evidence-uncertainty feature.

These are example feature definitions. A production system would need documented measurement methods, normalization rules, validation, and versioning.

We can encode those three values into a simulated quantum circuit and examine its output distribution. That gives us an experimental representation to study; it does not establish an accident probability.

The proposed three-qubit example below is a research prototype, separate from any claim that a particular three-qubit system is deployed for operational sensing.

# A reproducible NumPy and PennyLane experiment

The following prototype uses three qubits, one for each RGB input channel. It applies rotations and entangling gates, then examines the resulting state with NumPy.

The inputs are illustrative values. This example was executed locally before publication, with checks for normalization and the mathematical entropy bounds.

```python
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
```

The prototype uses classical state-vector simulation through PennyLane’s `default.qubit` device. It provides a reproducible structure for experiments involving feature encoding, interactions, distributions, and visualization.

For the illustrative input `[0.70, 0.30, 0.20]`, the local run produced approximately:

```text
Measurement entropy:        2.430597 bits
Normalized entropy:         0.810199
Qubit-0 subsystem entropy:  0.538330 bits
Display color:              #acac8d
Provenance:                  SIMULATED_RESEARCH_EXAMPLE
```

The normalized value of approximately 0.8102 describes this simulated measurement distribution. It does not mean an 81.02 percent chance of an accident. The display color is an experimental readout, not an operational road-caution classification.

The example makes no claim of quantum advantage, physical sensing capability, or improved accident prediction.

# Entropy needs a precise meaning

The example calculates two different quantities.

**Measurement entropy** describes how spread out the possible computational-basis measurement outcomes are. In this three-qubit example, it ranges from zero to three bits.

**Subsystem entropy** describes the mixedness of the reduced state of one qubit. Because the overall simulated state is pure, a nonzero value reflects entanglement across that qubit’s partition with the other two.

The full pure state has zero von Neumann entropy, even when its measurement distribution has positive Shannon entropy.

Those distinctions matter.

A broad measurement distribution does not automatically mean a dangerous street. An entangled simulated state does not demonstrate that two physical hazards interact in the real world. Neither quantity becomes a calibrated risk estimate simply because it is mapped to a percentage or color.

The experiment gives us mathematical quantities with defined meanings. Connecting them to transport decisions requires further evidence.

# How this could contribute to a better ribbon

One research direction is to keep three layers explicit.

## The evidence layer

This contains the supplied observations: mapped geometry, weather estimates, vehicle parameters, timestamps, and other supported information.

Each input should have a source and an account of its quality.

## The assessment layer

This contains the modeled caution assessment and explanation.

Its performance needs evaluation against appropriate data and outcomes. If a numerical output is presented as a probability, it needs probability calibration and supporting validation.

## The visualization layer

This controls how the information is displayed.

An experimental circuit-derived state could influence texture, transition, animation, or another visual treatment while retaining clear provenance. The operational color scale should continue to communicate a documented meaning.

Users should be able to identify whether they are looking at a modeled assessment, an evidence-quality indicator, or a simulated visual experiment.

That clarity is part of the product.

# Human oversight has to be an actual process

A useful human-in-the-loop arrangement requires more than placing a person beside an automated system.

Someone needs responsibility for reviewing relevant evidence, recognizing when it is inadequate, escalating a concern, and having the authority to stop or change an operation.

Organizations using QRS must independently decide how to staff, distribute, supervise, and assess those responsibilities. Individuals also retain their own obligations to inspect actual conditions, use appropriate expertise and equipment, and exercise independent judgment.

QRS can help organize information. A simulation cannot allocate a qualified crew, certify a maneuver, or decide that an organization’s risk-reduction program is adequate.

# What meaningful validation would look like

Progress should be measured through concrete questions.

Does a section explanation help someone identify a relevant issue they would otherwise have missed?

Does the system distinguish a verified restriction from an uncertain inference?

How often does a proposed maneuver conflict with supported geometry or available access information?

Does an uncertainty indicator improve interpretation—or create misplaced confidence?

Can users understand the difference between stale information, missing information, and a supported low-caution assessment?

Over time, evaluation should include:

- Reproducible datasets and documented assumptions.
- Separate development and evaluation data.
- Comparisons with simpler baselines.
- Calibration where probabilistic claims are made.
- Error analysis across vehicle types and environments.
- Human-factors testing.
- Independent review for consequential applications.

A claimed improvement should survive those checks.

# A long-term transport intelligence roadmap

Our roadmap begins with making the existing road workspace more useful and dependable.

That includes clearer explanations, better vehicle-specific context, stronger treatment of endpoint access, and more informative route comparisons.

Beyond that, we want to explore how the underlying approach could support aviation and maritime research: structured evidence, explicit uncertainty, domain-specific reasoning, and interfaces designed around the person making the decision.

The most distant ambition involves space.

Orbital operations, debris, docking, atmospheric entry, surface movement, and travel between planetary environments introduce radically different physics and assurance requirements. Any space-focused work would need a dedicated foundation in validated dynamics, high-integrity data, domain expertise, and the relevant engineering and operational standards.

The ambition is to carry forward a useful principle: make consequential information easier to inspect, understand, and question.

# The future we want to build

We want QRoadScan to contribute to fewer preventable accidents and better-informed journeys.

For a motorcyclist, that might begin with a clearer explanation of an exposed section and its weather context.

For a truck operator, it might involve recognizing a maneuver that deserves closer review.

For an aircraft pilot or a vessel operator, future research could help organize complex information into a more transparent briefing.

For space transport, that vision remains a distant research horizon.

Across those scales, our commitment is the same: build useful tools, make their assumptions visible, measure their performance honestly, and let evidence guide their development.

Every journey involves decisions. We want to help make the next one better informed.

Explore the [QRoadScan documentation](https://ride.qroadscan.com/docs), open the [route workspace](https://ride.qroadscan.com/dashboard), and review the [Terms of Service](https://qroadscan.com/terms/) for the Service’s limitations and your responsibilities.
